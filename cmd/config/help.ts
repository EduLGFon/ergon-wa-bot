import { Cmd, CmdCtx } from '../../map.js'
import cache from '../../plugin/cache.js'

export default class extends Cmd {
	constructor() {
		super({ alias: ['ajuda', 'menu', '?'] })
	}

	async run({ args, send, user, t }: CmdCtx) {
		if (args[0]) {
			// the user is searching for cmd-specific help info
			const cmd = cache.cmds.find(
				c => c.name === args[0] || c.alias.includes(args[0]),
			)
			// search cmd by name or alias

			if (!cmd) return send('Comando não encontrado.')
			const prefixedCmd = `\n*${user.prefix + cmd.name}* `
			const title = cmd.name.toPascalCase()
			const aliases = cmd.alias[0] ? cmd.alias.join(', ') : ''
			const description = t(`${cmd.name}.desc`)
			const usage = t('usage.title') + prefixedCmd + t(`${cmd.name}.usage`)
			const examples = t(`${cmd.name}.examples`, { returnObjects: true })

			const text = [
				`*[📖] - ${title}* (${aliases})\n`,
				`➥ ${description}\n`,
				usage,
			]

			if (Array.isArray(examples)) {
				// if there are examples
				text.push('\n' + t('usage.examples')) // examples title

				let a = cmd.alias[0] ? 0 : -1 // alias index, -1 if no aliases
				// if cmd has aliases, start from 0, otherwise -1 to use cmd name

				for (let e in examples) {
					if (a >= cmd.alias.length) a = 0 // reset alias index if it exceeds
					let cmdName = a === -1 ? cmd.name : cmd.alias[a++] // use cmd name if no alias

					const prefixedCmd = `➥ *${user.prefix}${cmdName}* ` // user prefix + cmd name
					text.push(prefixedCmd + examples[e])
				}

				text.push(`\n${t(`usage.args`)}`) // cmd argument types
			}

			send(text.join('\n').trim())
			return
		} // end cmd-specific block
		// now we'll show the cmd list

		const cmdsList = cache.cmds
			.filter((c: Cmd) => !c.access.restrict) // ignore dev cmds
			.sort((a, b) => a.name.localeCompare(b.name)) // sort by name
			.map(c => `➥ *${user.prefix}${c.name}*: ${t(`${c.name}.desc`)}`)
			// cmd description locales
			.join('\n')

		let text =
			t('help.title') +
			'\n\n' + // help menu title
			cmdsList // cmds list

		send(text)
	}
}
