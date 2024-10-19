import { DefaultArgs } from '@prisma/client/runtime/library';
import { PrismaClient } from '@prisma/client';
import { GroupMetadata } from 'baileys';
import { proto } from 'baileys';
import User from '../Core/User';
import Bot from '../Core/Bot';
import { pino } from 'pino';

type MsgTypes = 'conversation' | 'extendedTextMessage' | 'videoMessage' | 'imageMessage';

interface Msg {
	id: string;
	chat: string;
	author: string;
	text: string;
	type: string;
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
}

type Logger = pino.Logger<{ timestamp: () => string } & pino.ChildLoggerOptions>;
type Prisma = PrismaClient<Prisma.PrismaClientOptions, never, DefaultArgs>;
