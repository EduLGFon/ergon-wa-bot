import { createPartFromUri, GoogleGenAI } from 'gemini'
import defaults from 'defaults' with { type: 'json' }
import User from 'class/user.ts'
import { DateTime } from 'luxon'
import Cmd from 'class/cmd.ts'
import { Message } from 'wa'

export { checkPerms, delay, now }

// checkPerms: check cmd permissions like block random guys from using eval
function checkPerms(cmd: Cmd, user: User, msg: Message) {
	const isDev = defaults.devs.includes(user.phone)
	// if a normal user tries to run a only-for-devs cmd

	if (cmd.access.restrict && !isDev) return 'prohibited'

	if (msg.id.remote.includes('@g.us')) { // if msg chat is a group
		if (!cmd.access.groups) return 'block'

		// to do: add admins check
		// const admins = group.members.map((m) => m.admin && m.id)
		// // all group admins id

		// if (cmd.access.admin && (!admins.includes(user.chat) && !isDev)) {
		// 	return 'prohibited' // Devs can use admin cmds for security reasons
		// }
	} else if (!cmd.access.dm) return 'block'
	// if there's no group and cmd can't run on DM

	return true
}

// get 'now' date time formatted
function now(format = 'TT') {
	return DateTime.now()
		.setZone(defaults.timezone)
		.setLocale(defaults.lang)
		.toFormat(format) // TT = HOURS:MINITES:SECONDS
}

// delay: wait a few ms
async function delay(ms: num) {
	return await new Promise((resolve) => setTimeout(resolve, ms))
}

const GoogleAI = new GoogleGenAI({ apiKey: defaults.ai.gemini_key })

type GeminiArgs = {
	input: str
	user: User
	callBack?: Func
	file?: str
	model?: str
}
async function gemini({ input, user, callBack, file, model }: GeminiArgs) {
	let media
	if (file) {
		const upload = await GoogleAI.files.upload({ file })
		media = createPartFromUri(upload.uri!, upload.mimeType!)
	}

	const chat = GoogleAI.chats.create({
		model: model || defaults.ai.gemini,
		config: {
			systemInstruction:
				'Você é um assistente de IA que ajuda os usuários a interagir com o WhatsApp. Você deve responder como se fosse o WhatsApp.',
		},
		history: user.gemini,
	})

	const stream = await chat.sendMessageStream({ message: media ? [input, media] : [input] })
	let text = ''
	let interval: num
	if (callBack) interval = setInterval(() => callBack(text), 1_000)

	for await (const chunk of stream) text += chunk.text

	user.gemini = chat.getHistory()

	if (callBack) clearInterval(interval!)

	return {
		text,
	}
}
