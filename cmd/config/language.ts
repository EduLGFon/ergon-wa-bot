import { Cmd, CmdCtx, languages } from '../../map.js'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['lang'],
		})
	}

	async run({ t, args, send, user }: CmdCtx) {
		if (!languages.includes(args[0])) return send('usage.language')

		user.lang = args[0]

		send(t('language.changed', { lng: user.lang }))
		return
	}
}
