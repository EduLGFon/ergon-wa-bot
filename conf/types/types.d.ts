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
	author: num
	text: str
	type: MsgTypes
	media?: MediaMsg
	mime: str
	isBot: bool
	quoted?: Msg
	isEdited: bool
	key: proto.IMessageKey
	message?: proto.IMessage | null
	// this null is needed bc Baileys may return it as null or undefined
}

interface CmdCtx {
	msg: Msg
	user: User
	group: Group | undefined
	args: str[]
	cmd: Cmd
	startTyping(): Promise<void>
	send(str: str | AnyMessageContent, opts?: { user?: User; quoted?: Msg }): Promise<CmdCtx>
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
type Gparams = {
	model: str
	input: str
	user: User
	msg?: Msg
	file?: GoogleFile
}

export { CmdCtx, GoogleFile, Gparams, GroupMsg, MediaMsg, Msg, MsgTypes }
