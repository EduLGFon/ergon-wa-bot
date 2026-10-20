// WhatsApp reaction relay - emoji normalization and Telegram mapping.
//
// The merged footer in reaction-summary.ts is the display; native Telegram
// reactions are intentionally not set (Telegram rejects many WA emojis and
// each attempt burns an API slot). This module only normalizes emojis for
// callers that need Telegram's reaction vocabulary.

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
