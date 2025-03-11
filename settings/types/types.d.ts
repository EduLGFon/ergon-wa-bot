import { Baileys, Cmd, Group, User } from '../../map.ts'
import { ChatSession } from '@google/generative-ai'
import { TFunction } from 'i18next'
import { proto } from 'baileys'
import pino, { LoggerExtras, LoggerOptions } from 'pino'

type Logger<Options = LoggerOptions> =
	& pino.BaseLogger
	& LoggerExtras<Options>
	& CustomLevelLogger<Options>

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

interface DownloadableInfo {
	mediaKey: Uint8Array<ArrayBufferLike>
	url: str
	directPath: str
	thumbnailDirectPath: str
}

type MediaMsg =
	| { imageMessage: DownloadableInfo }
	| { videoMessage: DownloadableInfo }
	| { ptvMessage: DownloadableInfo }
	| { audioMessage: DownloadableInfo }

interface Msg {
	chat: str
	author: str
	edited: bool
	text: str
	type: MsgTypes
	isMedia: bool
	mime: str
	isBot: bool
	quoted: Msg
	message: MediaMsg | null
	key: proto.IMessageKey
}

interface CmdCtx {
	msg: Msg
	user: User
	group: Group | undefined
	bot: Baileys
	args: str[]
	cmd: Cmd
	t: TFunction<'translation', undefined>
	sendUsage(): Promise<void>
}

interface GroupMsg {
	author: num
	group: str
	count: num
}

export { aiPrompt, CmdCtx, GroupMsg, Lang, Logger, MediaMsg, Msg, MsgTypes }
