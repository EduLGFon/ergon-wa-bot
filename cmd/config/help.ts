import { Cmd, CmdCtx } from '../../map.js'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['ajuda', 'menu', '?'],
		})
	}

	async run({ t, bot, args, msg, user }: CmdCtx) {
		const cmdsList = bot.cache.cmds
			.filter((c: Cmd) => !c.access.restrict) // ignore dev cmds
			.map((c: Cmd) => `➥ *${user.prefix}${c.name}*: ${t(`${c.name}.desc`)}\n`)
			.join('')

		let text = t('help.title') + '\n\n' + // help menu title
			t('help.prefix', { prefix: `${user.prefix}prefix` }) + '\n\n' + // prefix msg
			cmdsList + '\n\n' + // cmds list
			t('help.lang', { lang: `${user.prefix}language` }) // lang msg

		if (args[0]) { // send single cmd info
			const c = bot.cache.cmds
				.find((c) => c.name === args[0] || c.alias.includes(args[0]))
			// search cmd by name or alias

			if (c) {
				const callCmd = `\n*${user.prefix + c.name}* ` // user prefix + cmd name
				const aliases = c.alias[0] ? `[${c.alias.join(', ')}]` : '' // all aliases
				const ex = t(`${c.name}.examples`) // all examples

				const examples = Array.isArray(ex)
					? `\n\n${t('usage.examples')}` +
						callCmd + ex.join(callCmd)
					: ''

				text = `*[📖] - ${c.name.toPascalCase()}* ${aliases}\n\n` + // cmd title + aliases
					'➥ ' + t(`${c.name}.desc`) + '\n\n' + // cmd description
					t('usage.title') + callCmd + t(`${c.name}.usage`) + // cmd usage
					examples + `\n\n${t(`usage.args`)}` // examples + args types
			}
		}

		bot.send(msg, text)
		return
	}
}
