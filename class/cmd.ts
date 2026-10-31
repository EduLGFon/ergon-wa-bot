// Abstract Cmd base class.
// Defines perms, cooldown, and run flow that all commands extend.
// Keeps permission checks in one place so commands stay small.
import { reactToMsg, sendMsg } from '@util/msgAbstractions.ts'
import { type CmdCtx, type Msg } from '@conf/types/types.d.ts'
import { type default as User } from '@class/user.ts'
import Group from '@class/group.ts'
import bot from '@plugin/bot.ts'

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
		this.access = Object.assign(
			{
				dm: true,
				groups: true,
				admin: false,
				restrict: false,
				needsDb: false,
			},
			c.access,
		)
		// Compare command permissions
		// with this default setting
	}

	abstract run(ctx: CmdCtx): Promise<any> // run function

	// SECURITY: permission gate - every command passes through here; deny by default.
	checkPerms(msg: Msg, user: User, group?: Group) {
		const send = sendMsg.bind(msg.chat)
		const react = reactToMsg.bind(msg)

		const devs = Deno.env.get('DEVS')?.split('|').map((v) => v.trim()).filter(Boolean) ?? []
		const isDev = devs.includes(user.lid)
		// if a normal user tries to run a only-for-devs cmd

		if (this.access.restrict && !isDev) {
			react('prohibited')
			send('events.restrict', { user })
			return false
		}
		// restrict means only devs can run this cmd

		if (group) {
			// if msg chat is a group
			if (!this.access.groups) {
				react('block')
				send('events.dmOnly', { user })
				return false
			} // this cmd can't run on groups

			// all group admins id
			const admins = group.members.filter((m) => m.admin).map((m) => m.id)

			// this user is not an admin and can't run this cmd
			if (this.access.admin && !admins.includes(user.lid) && !isDev) {
				react('prohibited') // Devs can use admin cmds for security reasons
				send('events.admin', { user })
				return false
			}

			// bot is not an admin and can't run this cmd
			if (this.access.botAdmin && !admins.includes(bot.lid)) {
				react('alert')
				send('events.botAdmin', { user })
				return false
			}
		} else if (!this.access.dm) {
			react('block') // this cmd can't run on DMs
			send('events.groupsOnly', { user })
			return false
		}

		if (this.access.needsDb && !Deno.env.get('DATABASE_URL')) {
			return send('events.nodb', { user })
		}
		// there is no DB and cmd can't run without it

		return true
	}
}
