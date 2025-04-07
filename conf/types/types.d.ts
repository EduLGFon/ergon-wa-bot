import type { Client, Message } from 'wa'
import User from 'class/user.ts'

interface CmdCtx {
	msg: Message
	bot: Client
	args: str[]
	user: User
}
