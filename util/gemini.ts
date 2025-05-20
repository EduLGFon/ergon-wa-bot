import { createPartFromUri, FileState, GenerateContentResponse, GoogleGenAI } from 'gemini'
import { createReminders, getUserReminders } from './reminders.ts'
import defaults from 'defaults' with { type: 'json' }
import { createMemories } from './memories.ts'
import { GeminiArgs, GoogleFile } from 'types'
import { delay } from './functions.ts'
import User from 'class/user.ts'

const GoogleAI = new GoogleGenAI({ apiKey: defaults.ai.gemini_key })
export default async function gemini(
	{ input, user, chat, file, callBack, args, model = defaults.ai.gemini }: GeminiArgs,
) {
	let upload
	let interval
	const isStream = input.startsWith('s ')
	const title = model.includes('2.0') ? 'gemini' : 'Gemini'
	const msg = {
		header: ``,
		text: '> ',
		tokens: -1,
		thoughts: 0,
	}
	if (isStream) {
		createInterval(callBack!, args, msg)
		input = input.slice(2)
	}
	if (file) upload = await uploadFile(file as GoogleFile, msg)
	const message = upload ? [createPartFromUri(upload.uri!, upload.mimeType!), input] : input

	const gemini = GoogleAI.chats.create({
		model,
		config: getModelConfig(user),
		history: user.gemini,
	})

	let stream
	if (isStream) stream = await gemini.sendMessageStream({ message })
	else stream = await gemini.sendMessage({ message })

	msg.header = ''
	// @ts-ignore i don't have another way to check this
	if (!stream.text) {
		stream = stream as AsyncGenerator<GenerateContentResponse>
		for await (const chunk of stream) handleResponse(chunk, msg)
	} else {
		stream = stream as GenerateContentResponse
		handleResponse(stream, msg)
	}

	msg.header =
		`- *${title} (Tokens: ${msg.tokens} ${
			msg.thoughts ? `| Raciocínio: ${msg.thoughts}` : ''
		})*\n` +
		msg.header

	createMemories(user, msg)
	createReminders(user, msg, chat!)
	msg.text = msg.text.replaceAll(/\* +/gi, '> ')
	msg.text = msg.text.replaceAll('**', '*')

	user.gemini = gemini.getHistory()

	if (callBack) {
		clearInterval(interval!)
		await delay(2_000)
		await callBack(...args, msg.header + msg.text)
	}
	// if (upload) GoogleAI.files.delete({ name: upload.name! })
	return
}

function handleResponse(chunk: GenerateContentResponse, msg: AIMsg) {
	msg.tokens = chunk?.usageMetadata?.totalTokenCount || -1
	msg.thoughts = chunk?.usageMetadata?.thoughtsTokenCount || 0

	if (chunk?.candidates) {
		const searches = chunk.candidates[0]?.groundingMetadata?.webSearchQueries
		if (searches) {
			// msg.header += `- *Pesquisando por* ` + searches.map((s) => '`' + s + '`').join(', ') +
			// 	'\n'
			msg.header += searches.map((s) => `- *Pesquisando por* \`${s}\`\n`).join('')
		}
	}
	if (chunk.text !== undefined) msg.text += chunk.text
}

function getModelConfig(user: User) {
	return {
		tools: [{ googleSearch: {} }],
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
	}
}

async function uploadFile(file: GoogleFile, msg: AIMsg) {
	/** Uploading file to Google File API (it's free)
	 * File API lets you store up to 20GB of files per project
	 * Limit: 2GB for each one
	 * Expiration: 48h
	 * Media cannot be downloaded from the API, only uploaded
	 */
	msg.header += '- *Google File API*\n- *Uploading file...*\n'
	let upload = await GoogleAI.files.upload({
		file: file.data.toBlob(),
		config: { mimeType: file.mime },
	})
	msg.header += `- *Upload complete.*\n`

	msg.header += `- *Processing file: ${upload.state}*\n`
	upload = await GoogleAI.files.get({ name: upload.name! }) // fetch its info
	while (upload.state === FileState.PROCESSING) { // media still processing
		msg.header += `- *Processing file: ${upload.state}*\n`

		// Sleep until it gets done
		await delay(3_000)
		// Fetch the file from the API again
		upload = await GoogleAI.files.get({ name: upload.name! })
	}

	// media upload failed
	if (upload.state === FileState.FAILED) throw new Error('Google server processing failed.')
	msg.header += `- *Processing complete: ${upload.state}*\n`

	return upload // return the file info
}

function createInterval(callBack: Func, args: any[], msg: AIMsg) {
	return setInterval(async () => await callBack(...args, msg.header + msg.text), 2_000)
}
