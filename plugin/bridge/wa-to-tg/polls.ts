// WhatsApp poll votes and results - encrypted vote relay in one place.
//
// Baileys can create polls but has no vote API, and its auto-decrypt of
// incoming votes is disabled - so both directions are hand-rolled here on
// the exact decryptPollVote scheme: incoming pollUpdateMessage carriers
// decrypt against the poll secret stored at mirror time and feed the
// per-poll tally (poll-tally.ts), while Telegram answers rebuild the
// encrypted vote and go out through relayMessage (sendMessage cannot carry
// votes). The vote is always cast by the owner's account - exact for this
// single-user bridge.
import { applyPollTally } from './poll-tally.ts'
import { parsePollOptions, parseTally, renderVoterDetail, totalOf } from './poll-tally.ts'
import {
	aesEncryptGCM,
	decryptPollVote,
	generateWAMessageFromContent,
	hmacSign,
	proto,
	sha256,
} from 'baileys'
import { bucketOfChat, chatForMapping, type GroupIds } from './routing.ts'
import { candidatesOf, normalizeJid, selfJid } from './jid.ts'
import { notifyTopic, relayCtx, shortErr, tgCall } from './state.ts'
import { waUnsupportedLine } from './unsupported.ts'
import { findKey } from '@util/functions.ts'
import type { BridgeDB, ReplyMapRow } from '../db.ts'
import { phoneOf } from './text.ts'
import type { Bot } from 'grammy'
import bot from '@plugin/bot.ts'

// Original messageSecret captured at mirror time - seals poll votes and,
// since newer clients encrypt every edit, MESSAGE_EDIT envelopes too.
export function msgSecretOf(waMsg: proto.IWebMessageInfo): Uint8Array | null {
	try {
		const s = (waMsg?.message as any)?.messageContextInfo?.messageSecret
		if (s && typeof s.length === 'number' && s.length > 0) return s as Uint8Array
		return null
	} catch {
		return null
	}
}

// Normalized JID of the poll author - own polls resolve to the owner,
// group polls to the participant, 1:1 polls to the peer.
export function pollCreatorOf(waMsg: proto.IWebMessageInfo): string {
	try {
		const key = waMsg?.key
		if (!key) return ''
		if (key.fromMe) return selfJid()
		return normalizeJid(key.participant || key.remoteJid)
	} catch {
		return ''
	}
}

// Normalized JID plus its LID/PN twin when the signal store knows it. Poll
// votes are signed over the exact JID form the voter used, which may be the
// LID even when the message key exposes the PN (or the reverse).
async function jidVariants(jids: Array<string | undefined | null>): Promise<string[]> {
	const out = new Set<string>()
	const map = (bot.sock as any)?.signalRepository?.lidMapping
	for (const raw of jids) {
		const n = normalizeJid(raw)
		if (!n || n.endsWith('@g.us') || n === 'status@broadcast') continue
		out.add(n)
		try {
			const twin = n.endsWith('@lid')
				? await map?.getPNForLID?.(n)
				: n.endsWith('@s.whatsapp.net')
				? await map?.getLIDForPN?.(n)
				: ''
			const norm = normalizeJid(typeof twin === 'string' ? twin : '')
			if (norm) out.add(norm)
		} catch {
			// Mapping unknown yet - the primary form is still tried.
		}
	}
	return [...out]
}

// Sender label for vote lines - same shape as the main upsert loop.
function voteSenderName(m: proto.IWebMessageInfo): string {
	const isGroup = (m.key?.remoteJid || '').endsWith('@g.us')
	if (m.key?.fromMe) return 'You'
	return isGroup
		? (m.pushName || phoneOf(m.key?.participant) || 'unknown')
		: (m.pushName || 'unknown')
}

// WhatsApp poll vote -> per-poll tally. Polls mirrored before vote support
// (no stored secret) fall back to the unsupported line.
export async function handleWaPollVote(m: proto.IWebMessageInfo): Promise<void> {
	const { db, groups } = relayCtx
	if (!db) return
	try {
		const node = findKey(m.message, 'pollUpdateMessage')
		const creationId = node?.pollCreationMessageKey?.id
		if (!node || !creationId || !m.key) return
		if (!m.key.remoteJid || m.key.remoteJid === 'status@broadcast') return
		const cands = candidatesOf(m.key)
		const mapping = cands.map((c) => db.getByJidOrAlias(c)).find((m) =>
			m && !m.archived && !m.muted
		)
		if (!mapping) return
		// Echoes of our own TG-TO-WA votes need no guard: applying the same
		// selection to the roster is idempotent, so the tally just updates.
		const entry = db.getByWaMsgIdAny(creationId, [mapping.whatsapp_jid, ...cands])
		const senderName = voteSenderName(m)
		if (!entry || !entry.wa_poll_secret || !entry.wa_poll_options) {
			const line = waUnsupportedLine(m, senderName)
			if (line) {
				await notifyTopic(
					chatForMapping(mapping, groups),
					mapping.telegram_topic_id,
					line,
				)
			}
			return
		}
		if (!node.vote?.encPayload || !node.vote?.encIv) return
		let options: string[] = []
		try {
			const parsed: unknown = JSON.parse(entry.wa_poll_options || '[]')
			if (Array.isArray(parsed)) options = parsed.filter((o) => typeof o === 'string')
		} catch {
			options = []
		}
		const nameByHash = new Map(
			options.map((n) => [sha256(Buffer.from(n)).toString('hex'), n]),
		)
		const me = selfJid()
		const tallyVoter = m.key.fromMe ? me : normalizeJid(m.key.participant || m.key.remoteJid)
		const voterJids = await jidVariants(
			m.key.fromMe ? [me, m.key.participant, m.key.remoteJid] : [
				m.key.participant,
				(m.key as any).participantAlt,
				m.key.remoteJid,
				(m.key as any).remoteJidAlt,
			],
		)
		if (voterJids.length === 0) return
		const creatorJids = await jidVariants([entry.wa_poll_creator])
		let vote: any = null
		let lastErr: unknown = null
		// WhatsApp signs the vote over the creator and voter JID forms it
		// chose; the message key may expose only the twin. Try the small
		// matrix (usually 1-2 x 1-2) before giving up.
		for (const creatorJid of creatorJids) {
			for (const voterJid of voterJids) {
				try {
					vote = decryptPollVote(
						{ encPayload: node.vote.encPayload, encIv: node.vote.encIv },
						{
							pollCreatorJid: creatorJid,
							pollMsgId: creationId,
							pollEncKey: Buffer.from(entry.wa_poll_secret),
							voterJid,
						},
					)
					break
				} catch (e) {
					lastErr = e
				}
			}
			if (vote) break
		}
		if (!vote) {
			console.error(
				'[BRIDGE] failed to decrypt one WA poll vote:',
				shortErr(lastErr),
				`creation=${
					creationId.slice(-8)
				} voters=${voterJids.length} creators=${creatorJids.length}`,
			)
			return
		}
		const names = (vote?.selectedOptions || [])
			.map((o: unknown) => nameByHash.get(Buffer.from(o as Uint8Array).toString('hex')))
			.filter((n: unknown): n is string => typeof n === 'string')
		if (names.length === 0 && !entry.wa_poll_tally) return
		await applyPollTally(entry, mapping, groups, tallyVoter || voterJids[0], senderName, names)
	} catch (e) {
		console.error('[BRIDGE] failed to relay one WA poll vote:', e)
	}
}

// WhatsApp poll results snapshot -> summary line in the topic.
export async function handleWaPollResults(m: proto.IWebMessageInfo): Promise<void> {
	const { db, limiter, tg, groups } = relayCtx
	if (!db || !limiter || !tg) return
	try {
		const node = findKey(m.message, 'pollResultSnapshotMessage') ||
			findKey(m.message, 'pollResultSnapshotMessageV3')
		if (!node || !m.key) return
		if (!m.key.remoteJid || m.key.remoteJid === 'status@broadcast') return
		const cands = candidatesOf(m.key)
		const mapping = cands.map((c) => db.getByJidOrAlias(c)).find((m) =>
			m && !m.archived && !m.muted
		)
		if (!mapping) return
		const name = String(node.name || 'Poll')
		const votes = Array.isArray(node.pollVotes) ? node.pollVotes : []
		const lines = votes.slice(0, 10).map((v: any) =>
			`${String(v?.optionName || '?')} - ${String(v?.optionVoteCount ?? 0)}`
		)
		await notifyTopic(
			chatForMapping(mapping, groups),
			mapping.telegram_topic_id,
			`📊 ${name}${lines.length > 0 ? `\n${lines.join('\n')}` : ''}`,
		)
	} catch (e) {
		console.error('[BRIDGE] failed to relay one WA poll result:', e)
	}
}

// Pure vote builder - encrypts the selected option names exactly per
// decryptPollVote (sign/key0/decKey/aad) so the construction is verifiable
// without a socket.
export function buildPollUpdate(
	creationKey: any,
	msgId: string,
	creator: string,
	voter: string,
	secret: Uint8Array,
	names: string[],
): ReturnType<typeof generateWAMessageFromContent> {
	const selectedOptions = names.map((n) => sha256(Buffer.from(n)))
	const voteBytes = proto.Message.PollVoteMessage.encode({ selectedOptions }).finish()
	const sign = Buffer.concat([
		Buffer.from(msgId),
		Buffer.from(creator),
		Buffer.from(voter),
		Buffer.from('Poll Vote'),
		new Uint8Array([1]),
	])
	const key0 = hmacSign(secret, new Uint8Array(32), 'sha256')
	const decKey = hmacSign(sign, key0, 'sha256')
	const iv = crypto.getRandomValues(new Uint8Array(12))
	const aad = Buffer.from(`${msgId}\0${voter}`)
	const encPayload = aesEncryptGCM(voteBytes, decKey, iv, aad)
	const full = generateWAMessageFromContent(creationKey?.remoteJid || '', {
		pollUpdateMessage: {
			pollCreationMessageKey: creationKey,
			vote: { encPayload, encIv: iv },
			senderTimestampMs: Date.now(),
		},
	}, { userJid: voter })
	return full
}

// Telegram vote -> WhatsApp pollUpdateMessage through raw relay. The vote is
// cast by the owner's account (single-user bridge) - relayMessage carries it
// because Baileys sendMessage has no vote branch.
export async function sendWaPollVote(entry: ReplyMapRow, names: string[]): Promise<void> {
	const secret = entry.wa_poll_secret ? Buffer.from(entry.wa_poll_secret) : null
	if (!secret || names.length === 0) throw new Error('poll key unknown')
	let key: any = null
	try {
		key = JSON.parse(entry.wa_key_json)
	} catch {
		key = null
	}
	if (!key?.id) throw new Error('poll key unknown')
	const creator = entry.wa_poll_creator || ''
	const voter = selfJid()
	if (!creator || !voter) throw new Error('poll key unknown')
	const full = buildPollUpdate(key, entry.wa_msg_id, creator, voter, secret, names)
	await (bot.sock as any).relayMessage(entry.wa_jid, full.message, {
		messageId: full.key.id || undefined,
	})
}

type WaSend = <T>(fn: () => Promise<T>) => Promise<T>

// Tap-to-vote plus voter viewer for mirrored WA polls (see D10). A tap
// rebuilds the encrypted selection and sends it exactly like a native TG
// poll answer; the tally (with fresh ticks) refreshes when the WA echo
// lands. Stateless callbacks - restarts never break them.
export function registerPollButtonHandlers(
	tg: Bot,
	db: BridgeDB,
	groups: GroupIds,
	waSend: WaSend,
): void {
	tg.callbackQuery(/^pv:(\d+):(\d+)$/, async (ctx) => {
		try {
			if (ctx.from?.is_bot) return
			const chatId = String(ctx.chat?.id ?? '')
			if (!chatId || bucketOfChat(chatId, groups) === null) {
				await ctx.answerCallbackQuery({ text: 'Unknown group.' }).catch(() => null)
				return
			}
			const mirrorId = Number(ctx.match?.[1])
			const idx = Number(ctx.match?.[2])
			const entry = db.getReplyMapAt(chatId, mirrorId)
			const mapping = entry && db.getByJidOrAlias(entry.wa_jid)
			if (!entry || !mapping || mapping.archived || mapping.muted) {
				await ctx.answerCallbackQuery({ text: 'This poll is gone.' }).catch(() => null)
				return
			}
			if (!entry.wa_poll_secret || !entry.wa_poll_creator) {
				await ctx.answerCallbackQuery({
					text: 'Voting from here is unavailable for this poll.',
				}).catch(() => null)
				return
			}
			const { options, multi } = parsePollOptions(entry.wa_poll_options)
			const opt = options[idx]
			if (!opt || idx < 0 || idx >= 10) {
				await ctx.answerCallbackQuery({ text: 'That option is gone.' }).catch(() => null)
				return
			}
			const me = selfJid()
			if (!me) {
				await ctx.answerCallbackQuery({ text: 'Bridge offline - try again in a bit.' })
					.catch(() => null)
				return
			}
			const cur = parseTally(entry.wa_poll_tally).voters[me]?.opts ?? []
			let names: string[]
			if (multi) {
				names = cur.includes(opt)
					? cur.filter((o) => o !== opt)
					: [...cur.filter((o) => options.includes(o)), opt]
				if (names.length === 0) {
					await ctx.answerCallbackQuery({
						text: 'Clearing your whole vote needs WhatsApp.',
					})
						.catch(() => null)
					return
				}
			} else {
				if (cur.length === 1 && cur[0] === opt) {
					await ctx.answerCallbackQuery({
						text: `Already voted for ${opt.slice(0, 80)}.`,
					})
						.catch(() => null)
					return
				}
				names = [opt]
			}
			const toast = multi
				? `Vote: ${names.join(', ').slice(0, 120)}`
				: `Voted: ${opt.slice(0, 120)}`
			await ctx.answerCallbackQuery({ text: toast }).catch(() => null)
			try {
				await waSend(() => sendWaPollVote(entry, names))
				db.updateLastActive(entry.wa_jid)
			} catch (e) {
				console.error('[BRIDGE] button vote failed:', shortErr(e))
				await tgCall(
					() =>
						tg.api.sendMessage(chatId, `⚠️ Couldn't vote for ${opt.slice(0, 80)}.`, {
							message_thread_id: mapping.telegram_topic_id,
							reply_parameters: {
								message_id: mirrorId,
								allow_sending_without_reply: true,
							},
						}),
					'notice',
					chatId,
				).catch(() => null)
			}
		} catch (e) {
			console.error('[BRIDGE] poll vote button failed:', e)
		}
	})

	tg.callbackQuery(/^pl:(\d+)$/, async (ctx) => {
		try {
			if (ctx.from?.is_bot) return
			const chatId = String(ctx.chat?.id ?? '')
			if (!chatId || bucketOfChat(chatId, groups) === null) {
				await ctx.answerCallbackQuery({ text: 'Unknown group.' }).catch(() => null)
				return
			}
			const mirrorId = Number(ctx.match?.[1])
			if (!Number.isFinite(mirrorId) || mirrorId <= 0) {
				await ctx.answerCallbackQuery({ text: 'Voters expired.' }).catch(() => null)
				return
			}
			const row = db.getReplyMapAt(chatId, mirrorId)
			const { options } = parsePollOptions(row?.wa_poll_options)
			const t = parseTally(row?.wa_poll_tally)
			if (!row || options.length === 0 || totalOf(t) === 0) {
				await ctx.answerCallbackQuery({ text: 'No votes yet.' }).catch(() => null)
				return
			}
			const text = renderVoterDetail(options, t)
			if (text.length <= 180) {
				await ctx.answerCallbackQuery({ text, show_alert: true }).catch(() => null)
				return
			}
			await ctx.answerCallbackQuery().catch(() => null)
			const mapping = db.getByJidOrAlias(row.wa_jid)
			await tgCall(
				() =>
					tg.api.sendMessage(chatId, text.slice(0, 1000), {
						message_thread_id: mapping?.telegram_topic_id,
						reply_parameters: {
							message_id: mirrorId,
							allow_sending_without_reply: true,
						},
					}),
				'message',
				chatId,
			).catch(() => null)
		} catch (e) {
			console.error('[BRIDGE] poll viewer button failed:', e)
		}
	})
}
