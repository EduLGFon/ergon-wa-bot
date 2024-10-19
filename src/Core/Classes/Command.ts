import type { CmdContext } from '../Typings/types.js';

export default abstract class Cmd {
	name: str;
	aliases: str[];
	cooldown: num;
	access: Partial<{
		dm: bool;
		groups: bool;
		onlyDevs: bool;
	}>;

	constructor(c: Partial<Cmd>) {
		this.name = '';
		this.aliases = c.aliases || [];
		this.cooldown = c.cooldown === 0 ? 0 : c.cooldown || 3; // Ignore some cmds cooldown
		this.access = Object.assign({
			dm: true,
			groups: true,
			onlyDevs: false,
		}, c.access);
		// Compare command permissions
	}

	abstract run(ctx: CmdContext): Promise<any>;
}
