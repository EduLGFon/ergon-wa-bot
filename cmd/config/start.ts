// Start command - welcome card for first-run onboarding
// Needed so new users discover language/prefix/help without reading docs
import { type CmdCtx } from '@conf/types/types.d.ts'
import Cmd from '@class/cmd.ts'

export default class extends Cmd {
	constructor() {
		super({ alias: ['menu', 'hi', 'ola', 'olá'], category: 'config' })
	}

	// deno-lint-ignore require-await
	async run({ user, send }: CmdCtx) {
		send(
			`*[👋] - Welcome to Ergon Bot*\n\n` +
				`1. Choose language: *${user.prefix}language*\n` +
				`2. Choose prefix: *${user.prefix}prefix*\n` +
				`3. See commands: *${user.prefix}help*\n\n` +
				`Reply with a number or command to continue.`,
		)
	}
}
