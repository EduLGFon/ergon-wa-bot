// Help command - shows cmd list and detail from cache
// Needed so users can discover usage without reading code
import { type CmdCtx } from '@conf/types/types.d.ts'
import cache from '@plugin/cache.ts'
import Cmd from '@class/cmd.ts'

const CATEGORIES: Record<string, string[]> = {
	config: ['help', 'language', 'prefix'],
	utility: [
		'clean',
		'download',
		'everyone',
		'gotcha',
		'remove',
		'reveal',
		'translate',
		'transcrypt',
	],
	fun: ['choose', 'gemini', 'rank', 'sticker'],
	dev: ['eval', 'execute', 'memory', 'ping'],
}

function categoryOf(name: str): str {
	for (const [cat, names] of Object.entries(CATEGORIES)) {
		if (names.includes(name)) return cat
	}
	return 'utility'
}

function levenshtein(a: str, b: str): num {
	if (a === b) return 0
	if (!a.length) return b.length
	if (!b.length) return a.length
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
	for (let i = 1; i <= a.length; i++) {
		const cur = [i]
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1
			cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
		}
		prev = cur
	}
	return prev[b.length]
}

function suggest(input: str, cmds: Cmd[]): Cmd | undefined {
	let best: { cmd: Cmd; d: num } | undefined
	for (const c of cmds) {
		const names = [c.name, ...c.alias]
		for (const n of names) {
			const d = levenshtein(input.toLowerCase(), n.toLowerCase())
			if (!best || d < best.d) best = { cmd: c, d }
		}
	}
	return best && best.d <= 3 ? best.cmd : undefined
}

export default class extends Cmd {
	constructor() {
		super({ alias: ['ajuda', 'menu', '?'], category: 'config' })
	}

	// deno-lint-ignore require-await
	async run({ args, send, user, t }: CmdCtx) {
		if (args[0]) {
			// the user is searching for cmd-specific help info
			const cmd = cache.cmds.find((c) => c.name === args[0] || c.alias.includes(args[0]))
			// search cmd by name or alias

			if (!cmd) {
				const s = suggest(args[0], [...cache.cmds.values()])
				if (s) {
					return send(
						`[❓] - ${t('help.notFound', { input: args[0] })}\n[💡] - ${
							t('help.didYouMean', { name: s.name })
						}`,
					)
				}
				return send(`[❓] - ${t('help.notFound', { input: args[0] })}`)
			}
			const prefixedCmd = `\n*${user.prefix + cmd.name}* `
			const title = cmd.name.toPascalCase()
			const aliases = cmd.alias[0] ? cmd.alias.join(', ') : ''
			const description = t(`${cmd.name}.desc`)
			const usage = t('usage.title') + prefixedCmd + t(`${cmd.name}.usage`)
			const examples = t(`${cmd.name}.examples`, { returnObjects: true })

			const badge = cmd.access.restrict
				? `[🛠️] - ${t('help.devOnly')}`
				: cmd.access.admin
				? `[🔒] - ${t('help.adminOnly')}`
				: cmd.access.groups && !cmd.access.dm
				? `[👥] - ${t('help.groupsOnly')}`
				: cmd.access.dm && !cmd.access.groups
				? `[📱] - ${t('help.dmOnly')}`
				: ''

			const text = [`*[📖] - ${title}* (${aliases})\n`, `➥ ${description}\n`, usage]
			if (badge) text.splice(1, 0, badge + '\n')

			if (Array.isArray(examples)) {
				// if there are examples
				text.push('\n' + t('usage.examples')) // examples title

				let a = cmd.alias[0] ? 0 : -1 // alias index, -1 if no aliases
				// if cmd has aliases, start from 0, otherwise -1 to use cmd name

				for (const e in examples) {
					if (a >= cmd.alias.length) a = 0 // reset alias index if it exceeds
					const cmdName = a === -1 ? cmd.name : cmd.alias[a++] // use cmd name if no alias

					const prefixedCmd = `➥ *${user.prefix}${cmdName}* ` // user prefix + cmd name
					text.push(prefixedCmd + examples[e])
				}

				text.push(`\n${t(`usage.args`)}`) // cmd argument types
			}

			send(text.join('\n').trim())
			return
		} // end cmd-specific block
		// now we'll show the cmd list grouped by category

		// dev cmds shown only to devs handled by filter below
		const devLids = (Deno.env.get('DEVS') || '').split('|').map((v) => v.trim()).filter(Boolean)
		const isDev = devLids.includes(user.lid)

		const groups: Record<string, Cmd[]> = { config: [], utility: [], fun: [], dev: [] }
		for (const c of cache.cmds.values()) {
			if (c.access.restrict && !isDev) continue
			const cat = c.category || categoryOf(c.name)
			if (!groups[cat]) groups[cat] = []
			groups[cat].push(c)
		}

		const sections: str[] = []
		for (const [cat, list] of Object.entries(groups)) {
			if (!list.length) continue
			const title = t(`help.category.${cat}`)
			const rows = list
				.sort((a, b) => a.name.localeCompare(b.name))
				.map((c) => `➥ *${user.prefix}${c.name}*: ${t(`${c.name}.desc`)}`)
				.join('\n')
			sections.push(`*${title}*\n${rows}`)
		}

		const text = t('help.title') + '\n\n' + sections.join('\n\n')
		send(text)
	}
}
