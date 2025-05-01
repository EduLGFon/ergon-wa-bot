import { createPartFromUri, FileState, GoogleGenAI, Part } from 'gemini'
import defaults from 'defaults' with { type: 'json' }
import { delay } from './functions.ts'
import User from 'class/user.ts'

export { gemini }

const GoogleAI = new GoogleGenAI({ apiKey: defaults.ai.gemini_key })

type GeminiArgs = {
	model?: str
	input: str
	user: User
	callBack?: Func
	args: any[]
	file?: {
		data: str
		mime: str
	}
}
async function gemini({ input, user, callBack, file, args, model }: GeminiArgs) {
	model = model || defaults.ai.gemini
	let message: str | [Part, str] = input
	let upload
	let headerTxt = `- *${model}*\n`
	let text = ''

	let interval: num
	if (callBack) {
		interval = setInterval(async () => await callBack(...args, headerTxt + text), 1_500)
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

	const chat = GoogleAI.chats.create({
		model,
		config: {
			systemInstruction:
				'Você é um membro de um grupo do WhatsApp. Sempre pesquise as informações antes de responder e vá direto ao ponto. Não use emojis. Use formatação do WhatsApp.',
			tools: [{ googleSearch: {} }],
		},
		history: user.gemini || [],
	})

	const stream = await chat.sendMessageStream({ message })

	for await (const chunk of stream) {
		headerTxt = `- *${model}*\n`
		const tokens = chunk?.usageMetadata?.totalTokenCount || -1
		const thoughts = chunk?.usageMetadata?.thoughtsTokenCount || 0

		headerTxt += `- *Tokens: ${tokens} | Raciocínio: ${thoughts}*\n`

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
	user.gemini = user.gemini ? [...user.gemini, ...chat.getHistory()] : chat.getHistory()

	if (callBack) {
		clearInterval(interval!)
		callBack(...args, headerTxt + text)
	}
	// if (upload) GoogleAI.files.delete({ name: upload.name! })

	return {
		text,
		model,
	}
}
