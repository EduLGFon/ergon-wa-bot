interface Msg {
	id: string;
	chat: string;
	participant: string;
	timestamp: number;
	username: string;
	text: string;
	type: string;
	raw: proto.IWebMessageInfo;
}

interface Command {
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
