// WhatsApp reaction relay - emoji normalization and Telegram mapping.
//
// Each side mirrors through a single bot identity so concurrent reactors are
// last-writer-wins by design - this normalizes WA emojis for Telegram, skips
// TG-initiated echoes and retries REACTION_INVALID with the default heart.
import { isTargetGone, reactionErrorDescription } from './errors.ts'
import { chatForReply } from './routing.ts'
import { candidatesOf } from './jid.ts'
import { relayCtx, tgCall } from './state.ts'
import type { proto } from 'baileys'

// Emojis already warned about (REACTION_INVALID) so repeats stay silent.
const warnedReactions = new Set<string>()

// Default Telegram reaction set when an incoming WhatsApp reaction emoji is
// rejected (REACTION_INVALID - unknown to Telegram or disabled in the
// supergroup's Settings -> Reactions). Plain ❤ without VS16, always in
// Telegram's allowed set; mirrors the TG-TO-WA custom-emoji fallback.
const DEFAULT_TG_REACTION = '❤'

// Normalize a WhatsApp reaction emoji for Telegram's reaction set:
// strip VS16 (❤️->❤) and skin-tone modifiers (👍🏽->👍), then map common
// WhatsApp reactions that Telegram simply doesn't offer (😂->🤣, ...).
// Returns the emoji as-is when unknown - Telegram may still accept it -
// and null for removals (empty text) so the caller clears the reaction.
export function waReactionToTgEmoji(text: string | null | undefined): string | null {
	if (!text) return null
	const clean = text.replace(/\uFE0F/g, '').replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '').trim()
	if (!clean) return null
	// Flags (regional-indicator pairs) are not Telegram reactions - seen as
	// 🇧🇷 REACTION_INVALID in prod. Fall back to the default instead of a
	// failing roundtrip.
	if (/^[\u{1F1E6}-\u{1F1FF}]{2,}$/u.test(clean)) return DEFAULT_TG_REACTION
	return WA_TO_TG_REACTION_FALLBACK[clean] || clean
}

// Everyday WhatsApp reactions with no Telegram reaction counterpart (all
// targets verified against Telegram's allowed reaction list). Anything not
// listed here is forwarded verbatim - REACTION_INVALID, if it comes, is
// contained by the caller above.
const WA_TO_TG_REACTION_FALLBACK: Record<string, string> = {
	'😂': '🤣',
	'😊': '🥰',
	'😅': '😁',
	'😌': '😇',
	'😏': '😎',
	'🥲': '😢',
	'😮': '😱',
	'😳': '😱',
	'🥺': '😢',
	'😤': '😡',
	'🙌': '🎉',
	'🫶': '❤',
	'💖': '❤',
	'💕': '❤',
	'🫀': '❤',
	'🤟': '❤',
	// Observed as REACTION_INVALID in prod (not Telegram reactions or
	// disabled): use the default heart instead of a failing roundtrip.
	'✨': '❤',
	'❓': '❤',
	'💭': '❤',
	// Laughing variants -> the verified laugh.
	'🤭': '🤣',
	'😹': '🤣',
	'💀': '🤣',
	'☠': '🤣',
	// Affection variants -> the verified heart-smile.
	'😘': '🥰',
	'🤗': '🥰',
	'🥹': '🥰',
	'😻': '🥰',
	// Grin variants -> the verified grin.
	'😋': '😁',
	'😜': '😁',
	'🤪': '😁',
	'😝': '😁',
	'😬': '😁',
	'🙈': '😁',
	'🙉': '😁',
	'🙊': '😁',
	// Sad variants -> the verified tear.
	'😭': '😢',
	'😥': '😢',
	// Shock variants -> the verified scream.
	'😰': '😱',
	'😵': '😱',
	'🫣': '😱',
	'🙀': '😱',
	// Celebration variants -> the verified party.
	'🎊': '🎉',
	'🥳': '🎉',
	'🥂': '🎉',
	'🎈': '🎉',
	'⭐': '🎉',
	'🌟': '🎉',
	'✌': '🎉',
	// Agreement variants -> thumbs up/down.
	'✅': '👍',
	'✔': '👍',
	'👌': '👍',
	'❌': '👎',
	// Rest -> verified calm, cool, hot and fire reactions.
	'😴': '😇',
	'🫡': '😎',
	'🥵': '🔥',
	// Heart-on-fire loses VS16 in normalization, so map the stripped form
	// back to the full sequence Telegram accepts.
	'❤‍🔥': '❤️‍🔥',
}

// Set (or clear, with null) the bot reaction on a Telegram mirror, retrying
// REACTION_INVALID once with the default heart. Shared by the
// last-writer-wins path below and the reaction-summary popular emoji.
export async function applyTgReaction(
	chatId: string,
	tgMsgId: number,
	emoji: string | null,
): Promise<void> {
	const { tg } = relayCtx
	if (!tg) return
	const payload = emoji ? [{ type: 'emoji' as const, emoji }] : []
	try {
		await tgCall(
			() => tg!.api.setMessageReaction(chatId, tgMsgId, payload as any),
			'reaction',
		)
	} catch (e) {
		// REACTION_INVALID = the emoji isn't usable here (not a
		// Telegram reaction at all, or disabled in this chat's
		// Settings -> Reactions). Retry once with the default
		// reaction so the sentiment still lands in the topic
		// instead of being silently dropped. A failing default
		// (reactions fully disabled?) gives up quietly - no
		// recursion. Never rethrows - reactions must not spam
		// the limiter log.
		// The mirror may also be gone by now (revoked on the WA
		// side or deleted in TG after the row was written) -
		// "message to react not found" is expected, not a fault.
		if (isTargetGone(e)) return
		const desc = reactionErrorDescription(e)
		if (desc.includes('REACTION_INVALID') && emoji) {
			try {
				await tgCall(
					() =>
						tg!.api.setMessageReaction(chatId, tgMsgId, [
							{ type: 'emoji', emoji: DEFAULT_TG_REACTION },
						] as any),
					'reaction',
				)
			} catch {
				// Default also rejected (reactions fully disabled?) - give up quietly.
			}
			if (!warnedReactions.has(emoji)) {
				warnedReactions.add(emoji)
				console.warn(
					`[BRIDGE] reaction ${emoji} rejected by Telegram (REACTION_INVALID): ` +
						`not a Telegram reaction emoji or disabled in this supergroup's Settings -> Reactions. Used default ${DEFAULT_TG_REACTION} instead.`,
				)
			}
			return
		}
		throw e
	}
}

// WhatsApp reaction -> Telegram reaction. Each side mirrors through a single
// bot identity (bots get one reaction per message on Telegram, one react per
// key on WhatsApp), so concurrent reactors are last-writer-wins by design.
export async function handleWaReactions(
	reactions: { key: proto.IMessageKey; reaction: proto.IReaction }[],
): Promise<void> {
	const { db, limiter, tg, groups } = relayCtx
	if (!db || !limiter || !tg) return

	for (const { key, reaction } of reactions) {
		try {
			const targetId = key?.id
			if (!targetId || !key?.remoteJid || key.remoteJid === 'status@broadcast') continue
			const cands = candidatesOf(key)
			const mapping = cands.map((c) => db.getByJidOrAlias(c)).find((m) =>
				m && !m.archived && !m.muted
			)
			if (!mapping) continue
			// Unmapped targets (pre-bridge history, pruned) can't be quoted
			// by Telegram - nothing to attach the reaction to.
			const target = db.getByWaMsgIdAny(targetId, [mapping.whatsapp_jid, ...cands])
			if (!target) {
				continue
			}

			const emoji = waReactionToTgEmoji(reaction?.text)
			// Echo of our own TG-TO-WA react (marked before the WA send) - the
			// TG message already shows this reaction; re-setting would loop.
			// NOTE: no blanket fromMe skip here. The bridge socket is the
			// owner's account, so genuine reactions made on the owner's phone
			// arrive with fromMe=true too - skipping those would drop every
			// own-phone reaction silently (only the marked echo is skipped).
			// The mark uses the reply_map row JID, so consume it the same way.
			if (db.takeTgReact(target.wa_jid, targetId, emoji || '')) {
				continue
			}
			const chatId = chatForReply(target, mapping, groups)
			await applyTgReaction(chatId, target.tg_msg_id, emoji)
		} catch (e) {
			console.error('[BRIDGE] failed to relay one WA reaction:', e)
		}
	}
}
