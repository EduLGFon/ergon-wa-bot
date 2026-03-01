import { type CmdCtx, Group, type Msg, type User } from '../map.js'
import { reactToMsg, sendMsg } from '../util/messages.js'
import bot from '../wa.js'

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
		botAdmin: bool // bot can only run the cmd if it's an admin
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
		const send = sendMsg.bind(msg.chat)
		const react = reactToMsg.bind(msg)

		const isDev = process.env.DEVS!.includes(user.lid)
		// if a normal user tries to run a only-for-devs cmd

		if (this.access.restrict && !isDev) return react('prohibited')
		// restrict means only devs can run this cmd

		if (group) { // if msg chat is a group
			if (!this.access.groups) return react('block') // this cmd can't run on groups

			// all group admins id
			const admins = group.members.map((m) => m.admin && m.id) || []

			// this user is not an admin and can't run this cmd
			if (this.access.admin && (!admins.includes(user.lid) && !isDev)) {
				return react('prohibited') // Devs can use admin cmds for security reasons
			}

			// bot is not an admin and can't run this cmd
			if (this.access.botAdmin && !admins.includes(bot.lid)) {
				return react('alert')
			}
		} else if (!this.access.dm) return react('block') // this cmd can't run on DMs

		if (this.access.needsDb && !process.env.DATABASE_URL) return send('events.nodb')
		// there is no DB and cmd can't run without it

		return true
	}
}
