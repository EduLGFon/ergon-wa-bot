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
import {
	aesEncryptGCM,
	decryptPollVote,
	generateWAMessageFromContent,
	hmacSign,
	proto,
	sha256,
} from 'baileys'
import { candidatesOf, normalizeJid, selfJid } from './jid.ts'
import { notifyTopic, relayCtx, shortErr } from './state.ts'
import { waUnsupportedLine } from './unsupported.ts'
import { chatForMapping } from './routing.ts'
import { findKey } from '@util/functions.ts'
import { phoneOf } from './text.ts'
import type { ReplyMapRow } from '../db.ts'
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
			await notifyTopic(
				chatForMapping(mapping, groups),
				mapping.telegram_topic_id,
				waUnsupportedLine(m, senderName),
			)
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
		const voterJid = m.key.fromMe ? me : normalizeJid(m.key.participant || m.key.remoteJid)
		let vote: any
		try {
			vote = decryptPollVote(
				{ encPayload: node.vote.encPayload, encIv: node.vote.encIv },
				{
					pollCreatorJid: entry.wa_poll_creator || '',
					pollMsgId: creationId,
					pollEncKey: Buffer.from(entry.wa_poll_secret),
					voterJid,
				},
			)
		} catch (e) {
			console.error('[BRIDGE] failed to decrypt one WA poll vote:', shortErr(e))
			return
		}
		const names = (vote?.selectedOptions || [])
			.map((o: unknown) => nameByHash.get(Buffer.from(o as Uint8Array).toString('hex')))
			.filter((n: unknown): n is string => typeof n === 'string')
		if (names.length === 0 && !entry.wa_poll_tally) return
		await applyPollTally(entry, mapping, groups, voterJid, senderName, names)
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
