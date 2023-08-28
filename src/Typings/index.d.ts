import { proto } from 'baileys';
import { GroupMetadata } from 'baileys';
import Bot from '../Core/Bot';

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

type MsgTypes = 'conversation' | 'extendedTextMessage' | 'videoMessage' | 'imageMessage';

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
