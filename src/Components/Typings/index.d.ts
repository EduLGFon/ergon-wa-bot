import { DefaultArgs } from '@prisma/client/runtime/library';
import { GroupMetadata, proto } from 'baileys';
import { PrismaClient } from '@prisma/client';
import User from 'src/Classes/User';
import Bot from 'src/Classes/Bot';
import { pino } from 'pino';
import { TFunction } from 'i18next';

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
	id: string;
	chat: string;
	author: string;
	text: string;
	type: MsgTypes;
	isMedia: boolean;
	raw: proto.IWebMessageInfo;
	quoted: Msg;
}

interface Cmd {
	name?: string;
	aliases?: string[];
	cooldown?: number;
	access?: {
		dm?: boolean;
		groups?: boolean;
		onlyDevs?: boolean;
	};
	react?: boolean;
	run?: Function;
}

interface CmdContext {
	prisma: Prisma;
	msg: Msg;
	user: User;
	group: GroupMetadata;
	bot: Bot;
	args: string[];
	cmd: Cmd;
	callCmd: string;
	t: TFunction<'translation', undefined>;
	sendUsage(): Promise<void>;
}

type Logger = pino.Logger<{ timestamp: () => string } & pino.ChildLoggerOptions>;
type Prisma = PrismaClient<Prisma.PrismaClientOptions, never, DefaultArgs>;
