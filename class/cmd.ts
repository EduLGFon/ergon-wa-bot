import { type CmdCtx, Group, type Msg, type User } from '../map.js'
import { react, send } from '../util/messages.js'

export default abstract class Cmd {
	name: str
	alias: str[]
	subCmds: str[]
	/** Cooldown in miliseconds */
	cooldown: num
	access: Partial<{
		dm: bool // cmd can run on DM
		groups: bool // cmd can run on groups
		admin: bool // only admins can run the cmd
		restrict: bool // only devs can run the cmd
		needsDb: bool // cmd requires database to run.
	}>

	constructor(c: Partial<Cmd>) {
		this.name = c.name || ''
		this.alias = c.alias || []
		// default cooldown is 3 seconds; allow explicit 0 to disable
		this.cooldown = c.cooldown === 0 ? 0 : c.cooldown || 3_000
		this.subCmds = c.subCmds || []
		this.access = Object.assign({
			dm: true,
			groups: true,
			admin: false,
			restrict: false,
			needsDb: false,
		}, c.access) // Compare command permissions
		// with this default setting
	}

	abstract run(ctx: CmdCtx): Promise<any> // run function

	async checkData() {}

	checkPerms(msg: Msg, user: User, group?: Group) {
		const reactMsg = react.bind(msg)
		const sendMsg = send.bind(msg.chat)

		const isDev = process.env.DEVS!.includes(user.phone)
		// if a normal user tries to run a only-for-devs cmd

		if (this.access.restrict && !isDev) return reactMsg('prohibited')
		// restrict means only devs can run this cmd

		if (group) { // if msg chat is a group
			if (!this.access.groups) return reactMsg('block') // this cmd can't run on groups

			const admins = group.members.map((m) => m.admin && m.id) || []
			// all group admins id

			if (this.access.admin && (!admins.includes(user.lid) && !isDev)) {
				return reactMsg('prohibited') // Devs can use admin cmds for security reasons
			}
		} else if (!this.access.dm) return reactMsg('block') // this cmd can't run on DMs

		if (this.access.needsDb && !process.env.DATABASE_URL) return sendMsg('events.nodb')
		// there is no DB and cmd can't run without it

		return true
	}
}
