import { DefaultArgs } from '@prisma/client/runtime/library';
import { GroupMetadata, proto } from 'baileys';
import { PrismaClient } from '@prisma/client';
import User from '../Classes/User';
import { TFunction } from 'i18next';
import Bot from '../Classes/Bot';
import { pino } from 'pino';

type Lang = 'py' | 'lua' | 'deno' | 'node' | 'eval' | 'cpp';

type Prisma = PrismaClient<Prisma.PrismaClientOptions, never, DefaultArgs>;
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
	id: str;
	chat: str;
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
	prisma: Prisma;
	msg: Msg;
	user: User;
	group: GroupMetadata;
	bot: Bot;
	args: str[];
	cmd: Cmd;
	callCmd: str;
	t: TFunction<'translation', undefined>;
	sendUsage(): Promise<void>;
}
