// Emoji names list
// it will be used to find emojis by name
// 'ok' -> '✅'
// Reaction contract (supplementary to text, never sole feedback):
// ok=success, x=failure, prohibited=permission denied, block=context not allowed,
// alert=bot lacks capability, loading=long op started, nodb=DB required,
// sparkles=ping/health only, random=sticker fun only.
//

const emojis = [
	'😂',
	'😢',
	'😡',
	'😍',
	'❤️',
	'👍',
	'👎',
	'😭',
	'😘',
	'🤗',
	'✨',
	'💭',
	'💡',
	'❓',
	'🇧🇷',
	'🤓',
	'🤨',
	'🫦',
	'🤣',
	'🥺',
	'😱',
	'😨',
	'🫣',
	'🫥',
	'🤡',
	'🤝',
	'🤏',
	'🙏',
	'👀',
	'🐦',
	'⚡',
	'🔥',
	'🏳️‍🌈',
]

export function randomEmoji(): string {
	return emojis[Math.floor(Math.random() * emojis.length)]
}

const restrictEmojis = {
	prohibited: '📛',
	sparkles: '✨',
	loading: '⌛',
	alert: '⚠️',
	block: '⛔',
	clock: '🕓',
	nodb: '📂',
	ok: '✅',
	x: '❌',
}

export default {
	...restrictEmojis,
}
