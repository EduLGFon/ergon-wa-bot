import { defaults, Group, type CmdCtx, type Msg, type User } from '../map.js'
import { react, send } from '../util/messages.js'

export default abstract class Cmd {
	name: str
	alias: str[]
	subCmds: str[]
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
		this.cooldown = c.cooldown === 0 ? 0 : c.cooldown || 3 // Ignore some cmds cooldown
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

		const isDev = defaults.devs.includes(user.phone)
		// if a normal user tries to run a only-for-devs cmd

		if (this.access.restrict && !isDev) return reactMsg('prohibited')

		if (group) { // if msg chat is a group
			if (!this.access.groups) return reactMsg('block')

			const admins = group.members.map((m) => m.admin && m.id) || []
			// all group admins id

			if (this.access.admin && (!admins.includes(user.chat) && !isDev)) {
				return reactMsg('prohibited') // Devs can use admin cmds for security reasons
			}
		} else if (!this.access.dm) return reactMsg('block')
		// if there's no group and cmd can't run on DM

		if (this.access.needsDb && !process.env.DATABASE_URL) return sendMsg('events.nodb')
		
		// if cmd requires database to run
		return true
	}
}
