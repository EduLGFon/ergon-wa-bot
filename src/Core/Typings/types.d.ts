import { GroupMetadata, proto } from 'baileys';
import Group from '../Classes/Group.ts';
import User from '../Classes/User.ts';
import { TFunction } from 'i18next';
import Bot from '../Classes/Bot.ts';
import { pino } from 'pino';

type Lang = 'py' | 'lua' | 'deno' | 'node' | 'eval' | 'cpp';

type Logger = pino.Logger<{ timestamp: () => str } & pino.ChildLoggerOptions>;

type MsgTypes =
	| 'text'
	| 'image'
	| 'sticker'
	| 'video'
	| 'contact'
	| 'document'
	| 'audio'
	| 'protocol'
	| 'reaction'
	| 'location';

interface Msg {
	key: proto.IMessageKey;
	chat: str;
	edited: bool;
	text: str;
	type: MsgTypes;
	isMedia: bool;
	raw: proto.IWebMessageInfo;
	quoted: Msg;
}

interface Cmd {
	name?: str;
	aliases?: str[];
	cooldown?: num;
	access?: {
		dm?: bool;
		groups?: bool;
		onlyDevs?: bool;
	};
	react?: bool;
	run?: Function;
}

interface CmdContext {
	msg: Msg;
	user: User;
	group: Group | undefined;
	bot: Bot;
	args: str[];
	cmd: Cmd;
	callCmd: str;
	t: TFunction<'translation', undefined>;
	sendUsage(): Promise<void>;
}

interface GroupMsg {
	author: str;
	group: str;
	count: num;
}
