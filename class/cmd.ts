import type { CmdCtx } from 'types'

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
		this.name = c.name || ''
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
}
