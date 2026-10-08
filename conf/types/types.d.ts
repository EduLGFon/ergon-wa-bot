// Shared CmdCtx, Msg, and Media types.
// Gives commands and utils a common shape for handler args.
// Avoids circular imports between class and util modules.
import type { AnyMessageContent, proto } from 'baileys'
import type { TFunction } from 'i18next'
import type Group from '@class/group.ts'
import type User from '@class/user.ts'
import emojis from '@util/emojis.ts'
import type Cmd from '@class/cmd.ts'

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
	react(emoji: str | (typeof emojis)[keyof typeof emojis]): Promise<void>
	t: TFunction<'translation', undefined>
}

type GoogleFile = {
	buffer: Uint8Array | ArrayBuffer
	mime: str
}
type Gparams = {
	model: str
	input: str
	user: User
	msg?: Msg
	file?: GoogleFile
}

export type { CmdCtx, GoogleFile, Gparams, Msg, MsgTypes }
