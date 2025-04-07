/** Emoji names list
 * it will be used to find emojis by name
 * 'ok' -> '✅'
 */

const funEmojis = {
	funny: '😂',
	sad: '😢',
	angry: '😡',
	love: '😍',
	heart: '❤️',
	like: '👍',
	dislike: '👎',
	cry: '😭',
	kiss: '😘',
	hug: '🤗',
	sparkles: '✨',
	think: '💭',
	light: '💡',
	question: '❓',
}

function randomEmoji(): string {
	const emojis = Object.values(funEmojis)
	return emojis[Math.floor(Math.random() * emojis.length)]
}

const restrictEmojis = {
	prohibited: '📛',
	loading: '⌛',
	block: '⛔',
	clock: '🕓',
	nodb: '📂',
	ok: '✅',
	x: '❌',
}

export { randomEmoji, restrictEmojis }
export default {
	...funEmojis,
	...restrictEmojis,
}
