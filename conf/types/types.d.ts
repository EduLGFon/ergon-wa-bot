import { Baileys, Cmd, emojis, Group, User } from '../../map.ts'
import { ChatSession } from '@google/generative-ai'
import { AnyMessageContent, proto } from 'baileys'
import { TFunction } from 'i18next'

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
	chat: str
	author: str
	text: str
	type: MsgTypes
	media?: MediaMsg
	mime: str
	isBot: bool
	quoted?: Msg
	isEdited: bool
	key: proto.IMessageKey
}

interface CmdCtx {
	msg: Msg
	user: User
	group: Group | undefined
	args: str[]
	cmd: Cmd
	startTyping(): Promise<void>
	send(str: str | AnyMessageContent, user?: User): Promise<CmdCtx>
	react(emoji: str | ReturnType<typeof emojis>): Promise<void>
	deleteMsg(): Promise<void>
	t: TFunction<'translation', undefined>
}

interface GroupMsg {
	author: num
	group: str
	count: num
}

type GoogleFile = {
	buffer: Buf<ArrayBufferLike> | ArrayBuffer
	mime: str
}
type GeminiArgs = {
	model?: num
	input: str
	user: User
	chat?: str
	callBack: Func
	args: any[]
	file?: GoogleFile
}

export { CmdCtx, GeminiArgs, GoogleFile, GroupMsg, MediaMsg, Msg, MsgTypes }
