import { createReminders, getUserReminders, reminderRegex } from './reminders.ts'
import { createPartFromUri, FileState, GoogleGenAI, Part } from 'gemini'
import { createMemories, delay } from './functions.ts'
import defaults from 'defaults' with { type: 'json' }
import User from 'class/user.ts'

export { gemini }

const GoogleAI = new GoogleGenAI({ apiKey: defaults.ai.gemini_key })

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
const memoryRegex = /{MEMORY:( |)[a-z].+}/gi

async function gemini({ input, user, chat, callBack, file, args, model }: GeminiArgs) {
	model = model || defaults.ai.gemini
	let message: str | [Part, str] = input
	let upload
	let headerTxt = `- *${model}*\n`
	let text = ''

	let interval: num
	if (callBack) {
		interval = setInterval(async () => await callBack(...args, headerTxt + text), 2_000)
	}

	if (file) {
		/** Uploading file to Google File API (it's free)
		 * File API lets you store up to 20GB of files per project
		 * Limit: 2GB for each one
		 * Expiration: 48h
		 * Media cannot be downloaded from the API, only uploaded
		 */
		headerTxt += '- *Uploading file to Google File API...*\n'
		upload = await GoogleAI.files.upload({
			file: file.data.toBlob(),
			config: { mimeType: file.mime },
		})
		headerTxt += '- *Upload complete*\n'

		upload = await GoogleAI.files.get({ name: upload.name! }) // fetch its info
		while (upload.state === FileState.PROCESSING) { // media still processing
			headerTxt += `- *Processing file: ${upload.state}*\n`

			// Sleep until it gets done
			await delay(3_000)
			// Fetch the file from the API again
			upload = await GoogleAI.files.get({ name: upload.name! })
		}
		headerTxt += `- *Processing complete: ${upload.state}*\n`

		// media upload failed
		if (upload.state === FileState.FAILED) {
			headerTxt += '- *Google servers processing failed*\n'
			throw new Error('Google servers processing failed.')
		}

		message = [createPartFromUri(upload.uri!, upload.mimeType!), input]
	}

	const geminiChat = GoogleAI.chats.create({
		model,
		config: {
			systemInstruction: [
				'Você é um assistente de IA que ajuda os usuários a encontrar informações na web.',
				'Você deve fornecer respostas curtas e diretas.',
				'Sempre pesquise na web antes de responder.',
				'Ao longo da conversa, você deve anotar tudo que aprender sobre o usuário em várias memórias.',
				'Modelo de Memória: "{MEMORY:message}"',
				'Exemplo: "{MEMORY:O usuário tem um cachorro chamado Pedro}"',
				'Se um usuário pedir para que você o lembre de algo daqui a algum tempo, você deve criar um alarme.',
				'Converta a data do alarme para daqui a years (y), months (mo), weeks (w), days (d), hours (h), minutes (m) ou seconds (s).',
				'Modelo de Lembrete: "{REMINDER:humurous message:duration}"',
				'Exemplo: "{REMINDER:Coloca comida pro Pedro senão ele vai morrer de fome:1h}"',
				'Os alarmes servem apenas para lembrar o usuário de algo.',
				'Memórias do usuário:',
				...user.memories,
				'Lembretes do usuário:',
				...getUserReminders(user),
			],
			tools: [{ googleSearch: {} }],
		},
		history: user.gemini,
	})

	const stream = await geminiChat.sendMessageStream({ message })

	for await (const chunk of stream) {
		const tokens = chunk?.usageMetadata?.totalTokenCount || -1
		const thoughts = chunk?.usageMetadata?.thoughtsTokenCount || 0

		headerTxt = `- *${model}*\n` + `- *Tokens: ${tokens} | Raciocínio: ${thoughts}*\n`

		if (chunk.candidates) {
			const searches = chunk.candidates[0]?.groundingMetadata?.webSearchQueries
			if (searches) {
				for (const result of searches) {
					headerTxt += `- *Pesquisando por* \`${result}\`\n`
				}
			}
		}

		if (chunk.text !== undefined) text += chunk.text
	}

	if (memoryRegex.test(text)) {
		const matches = text.match(memoryRegex)!
		const memories = createMemories(user, matches)
		matches.forEach((m, i) => text.replace(m, memories[i])) // remove memories from text
	}
	if (reminderRegex.test(text)) text = createReminders(user, text, chat!)

	user.gemini = geminiChat.getHistory()

	if (callBack) {
		clearInterval(interval!)
		await delay(2_000)
		await callBack(...args, headerTxt + text)
	}
	// if (upload) GoogleAI.files.delete({ name: upload.name! })

	return {
		text,
		model,
	}
}
