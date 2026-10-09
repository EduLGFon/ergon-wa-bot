// WhatsApp reaction relay - emoji normalization and Telegram mapping.
//
// Telegram bots get one native reaction per message, so the merged footer
// in reaction-summary.ts is the primary display - this normalizes WA emojis
// for the best-effort popular-emoji mirror and retries REACTION_INVALID
// with the default heart.
import { isTargetGone, reactionErrorDescription } from './errors.ts'
import { relayCtx, tgCall } from './state.ts'

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
// REACTION_INVALID once with the default heart. Used for the best-effort
// popular-emoji mirror beside the merged footer (see reaction-summary.ts).
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
			chatId,
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
					chatId,
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
