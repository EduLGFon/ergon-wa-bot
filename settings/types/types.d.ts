import { Baileys, Cmd, Group, User } from '../../map.ts'
import { TFunction } from 'i18next'
import { proto } from 'baileys'
import { pino } from 'pino'

type Lang = 'py' | 'lua' | 'deno' | 'node' | 'cpp'
export type Logger = P.pino.Logger<never>

type MsgTypes =
	| 'text'
	| 'image'
	| 'sticker'
	| 'video'
	| 'audio'
	| 'contact'
	| 'document'
	| 'location'
	| 'call'
	| 'callLog'
	| 'reaction'
	| 'pin'
	| 'event'
	| 'protocol'
	| 'button'
	| 'template'
	| 'buttonReply'
	| 'poll'
	| 'pollUpdate'

interface Msg {
	key: proto.IMessageKey
	chat: str
	edited: bool
	text: str
	type: MsgTypes
	isMedia: bool
	isBot: bool
	quoted: Msg
	raw: proto.IWebMessageInfo
}

interface CmdCtx {
	msg: Msg
	user: User
	group: Group | undefined
	bot: Baileys
	args: str[]
	cmd: Cmd
	callCmd: str
	t: TFunction<'translation', undefined>
	sendUsage(): Promise<void>
}

interface GroupMsg {
	author: str
	group: str
	count: num
}

export { CmdCtx, GroupMsg, Lang, Logger, Msg, MsgTypes }
