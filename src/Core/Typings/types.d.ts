// import { BroadcastChannel } from 'node:worker_threads';
import Group from '../Classes/Group.ts';
import Cmd from '../Classes/Command.ts';
import User from '../Classes/User.ts';
import _globals from './global.d.ts';
import { TFunction } from 'i18next';
import Bot from '../Classes/Bot.ts';
import { proto } from 'baileys';
import { pino } from 'pino';
type Lang = 'py' | 'lua' | 'deno' | 'node' | 'cpp';

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
	isBot: bool;
	quoted: Msg;
	raw: proto.IWebMessageInfo;
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
