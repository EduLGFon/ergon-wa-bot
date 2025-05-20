import type { Message, MessageMedia, MessageSendOptions } from 'wa'
import User from 'class/user.ts'
import emojis from 'util/emojis.ts'

interface CmdCtx {
	msg: Message
	args: str[]
	user: User
	send(text: str | MessageMedia, options?: MessageSendOptions): Promise<Message>
	react(emoji: keyof typeof emojis): Promise<void>
}

type GeminiArgs = {
	model?: str
	input: str
	user: User
	chat?: str
	callBack?: Func
	args: any[]
	file?: {
		data: str
		mime: str
	}
}
