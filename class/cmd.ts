import defaults from 'defaults' with { type: 'json' }
import type { CmdCtx } from 'types'
import User from './user.ts'
import { Message } from 'wa'

export default abstract class Cmd {
	name: str
	alias: str[]
	subCmds: str[]
	cooldown: num
	access: Partial<{
		dm: bool // only works on DM
		groups: bool // only works on groups
		admin: bool // only admins can run the cmd
		restrict: bool // only devs can run the cmd
	}>

	constructor(c: Partial<Cmd>) {
		this.name = c.name!
		this.alias = c.alias || []
		this.cooldown = c.cooldown === 0 ? 0 : c.cooldown || 3_000 // Ignore some cmds cooldown
		this.subCmds = c.subCmds || []
		this.access = Object.assign({
			dm: true, // only works on DM
			groups: true, // only works on groups
			admin: false, // only admins can run the cmd
			restrict: false, // only devs can run the cmd
		}, c.access) // Compare command permissions
		// with this default setting
	}

	abstract run(ctx: CmdCtx): any // run function

	// checkPerms: check cmd permissions like block random guys from using eval
	checkPerms(user: User, msg: Message) {
		const isDev = defaults.devs.includes(user.phone)
		// if a normal user tries to run a only-for-devs cmd

		if (this.access.restrict && !isDev) return 'prohibited'

		if (msg.to.includes('@g.us')) { // if msg chat is a group
			if (!this.access.groups) return 'block'

			// to do: add admins check
			// const admins = group.members.map((m) => m.admin && m.id)
			// // all group admins id

			// if (cmd.access.admin && (!admins.includes(user.chat) && !isDev)) {
			// 	return 'prohibited' // Devs can use admin cmds for security reasons
			// }
		} else if (!this.access.dm) return 'block'
		// if there's no group and cmd can't run on DM

		return true
	}
}
