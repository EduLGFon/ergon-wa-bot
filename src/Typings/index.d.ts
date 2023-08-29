import { proto } from 'baileys';
import { GroupMetadata } from 'baileys';
import Bot from '../Core/Bot';

type MsgTypes = 'conversation' | 'extendedTextMessage' | 'videoMessage' | 'imageMessage';

interface Msg {
	id: string;
	author: string;
	chat: string;
	username: string;
	group: GroupMetadata;
	text: string;
	type: string;
	raw: proto.IWebMessageInfo;
	quoted: Msg;
}

interface User {
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
	run?: Function;
}

interface CmdContext {
	msg: Msg;
	args: string[];
	cmd: Map<string, Cmd>;
	bot: Bot;
}
