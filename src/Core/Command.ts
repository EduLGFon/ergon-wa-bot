import type { Cmd, CmdContext, Msg } from '../Typings';
import type Bot from './Bot';

export default abstract class Command implements Cmd {
	constructor(public bot: Bot, db: any) {
		this.bot = bot;
	}

	abstract run(ctx: CmdContext): Promise<any>;
}
