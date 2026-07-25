import { languages } from '../../util/locale.ts'
import Cmd from '@class/cmd.ts'
import { type CmdCtx } from '@conf/types/types.d.ts'

export default class extends Cmd {
	constructor() {
		super({ alias: ['lang'] })
	}

	run({ t, args, send, user }: CmdCtx) {
		if (!languages.includes(args[0])) return send('usage.language', { user })
		// it's a crappy implementation, but all languages are listed on help menu

		user.lang = args[0] // setter lang() will also change it on DB, if there is one

		send(t('language.changed', { lng: user.lang.encode() }))
	}
}
