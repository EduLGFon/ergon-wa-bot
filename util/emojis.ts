/** Emoji names list
 * it will be used to find emojis by name
 * 'ok' -> '✅'
 */

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
