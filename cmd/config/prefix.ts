import { Cmd, CmdCtx } from '../../map.js'

export default class extends Cmd {
	constructor() {
		super({})
	}

	async run({ t, user, send, args }: CmdCtx) {
		if (!args[0] || args[0].length > 3) return send('usage.prefix', { user })

		user.prefix = args[0] // setter prefix() will also change it on DB, if there is one

		send(t('prefix.changed', { prefix: user.prefix.encode() }))
		return
	}
}
