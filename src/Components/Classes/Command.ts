import type { Cmd, CmdContext } from '../Typings/index';

export default abstract class Command implements Cmd {
	name?: string;
	aliases?: string[];
	cooldown?: number;
	react?: boolean;
	access?: {
		dm?: boolean;
		groups?: boolean;
		onlyDevs?: boolean;
	};

	constructor(c: Cmd) {
		this.name = '';
		this.aliases = c.aliases || [];
		this.cooldown = c.cooldown || 3;
		this.react = true;
		this.access = Object.assign({
			dm: true,
			groups: true,
			onlyDevs: false,
		}, c.access);
		// Compare command permissions
	}

	abstract run(ctx: CmdContext): Promise<any>;
}
