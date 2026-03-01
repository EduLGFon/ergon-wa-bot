import { Cmd, CmdCtx, delay, isValidPositiveIntenger } from '../../map.js'

export default class extends Cmd {
	constructor() {
		super({
			cooldown: 10_000,
			access: {
				groups: true,
				dm: false,
				admin: true,
				botAdmin: true,
			},
			subCmds: ['reverse'],
		})
	}

	async run({ msg, args, send, user, group, t }: CmdCtx) {
		group = group!
		let disclaimerMsgCtx
		const amount = Number(args[0]) // amount of msgs to be deleted for everyone-

		if (amount === 0) return send(t('clean.noAmount'))

		if (!isValidPositiveIntenger(amount)) return send('usage.clean', { user })

		// the bot can only delete up to 200 msgs bc thats the max msgs that can be cached
		if (group.msgs.size < amount) {
			// send a disclaimer msg that only x msgs can be deleted
			disclaimerMsgCtx = await send(t('clean.deleted', { msgsSize: group.msgs.size }))
		}

		let msgs = group.msgs
			.reverse() // reverse to delete newest msgs first
			.slice(1, amount + 1)

		if (this.subCmds[0] === args[1]) msgs = msgs.reverse()
		// it will delete oldest msgs first

		for (const i in msgs) {
			// delay every 10 msgs to prevent rate limiting
			if (Number(i) % 10 === 0 && i !== '0') await delay(1_000)
			// delete msg for everyone
			await send.bind(msgs[i].chat)({ delete: msgs[i].key })
			// delete it from cache
			group.msgs.delete(msgs[i].key.id!)
			// delay 500ms to prevent rate limiting
			await delay(500)
		}

		if (disclaimerMsgCtx) { // delete disclaimer msg
			await send.bind(disclaimerMsgCtx.msg)({ delete: disclaimerMsgCtx.msg.key })
			group.msgs.delete(disclaimerMsgCtx.msg.key.id!)
		}

		await send.bind(msg)({ delete: msg.key }) // delete cmd msg
		group.msgs.delete(msg.key.id!)
	}
}
