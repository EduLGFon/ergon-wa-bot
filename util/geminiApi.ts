import {
	createPartFromUri,
	FileState,
	GenerateContentConfig,
	GenerateContentResponse,
	GoogleGenAI,
} from '@google/genai'
import { GoogleFile, Gparams } from '../conf/types/types.js'
import { randomDelay, randomTime } from './functions.js'
import { createMemories } from '../plugin/memories.js'
import { createAlarms } from '../plugin/alarms.js'
import { ThinkingLevel } from '@google/genai'
import { sendOrEdit } from './messages.js'
import { delay, User } from '../map.js'

const GoogleAI = new GoogleGenAI({ apiKey: process.env.GEMINI })

export default async function gemini({ input, user, msg, file, model }: Gparams) {
	let upload
	let interval
	const res = {
		header: '',
		text: '',
		msg: { chat: msg?.chat },
	}
	const callCallback = async () => await sendOrEdit(res, res.header + res.text.trim(), msg)
	const startStreaming = async () => {
		await callCallback()
		interval = setInterval(
			async () => await callCallback(),
			randomTime(1_500, 2_400),
		)
		return
	}

	if (file) upload = await uploadFile(file as GoogleFile, res)
	const message = upload ? [createPartFromUri(upload.uri!, upload.mimeType!), input] : input

	const gemini = GoogleAI.chats.create({
		model,
		config: getModelConfig(user),
		history: user.gemini,
	})

	const stream = await gemini.sendMessageStream({ message })
	res.header = `- *${model}*:\n`

	for await (const chunk of stream) await handleResponse(chunk, res, startStreaming)
	clearInterval(interval!)

	await createMemories(user, res)
	await createAlarms(user, res, msg?.chat!)

	user.gemini = gemini.getHistory()

	await randomDelay(1_500, 2_500)
	return await callCallback()
}

async function handleResponse(chunk: GenerateContentResponse, msg: AIMsg, startStreaming: Func) {
	if (chunk?.candidates) {
		let web = chunk.candidates[0]?.groundingMetadata?.webSearchQueries
		if (web) {
			let searches = ''
			if (web.length > 3) {
				searches = web.slice(0, 3).map((s) => s.encode()).join(', ') + ', `...`'
			} else {
				searches = web.map((s) => s.encode()).join(', ')
			}
			msg.header += `- 🔍 ${searches}\n`
		}
	}
	if (chunk.text) {
		if (!msg.text) {
			msg.text += chunk.text
			await startStreaming()
		} else msg.text += chunk.text
	}
}

function getModelConfig(user: User) {
	return {
		tools: [
			// { googleSearch: {} },
			{ urlContext: {} },
			// { codeExecution: {} },
		],
		thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
		systemInstruction: [
			'> Você deve seguir as configurações padrão se o usuário ou uma memória não especificá-las',
			'- Use o máximo de raciocínio para transcrições',
			'- Gere respostas extremamente curtas e resumidas com no máximo 1 frase',
			'- Use formatação do WhatsApp',
			'- Destaque informações importantes do texto com *, _ ou `',
			'# Escreva uma memória quando o usuário pedir que você lembre de algo ou quando te der uma informação importante',
			'# Modelo de Memória: "{MEMORY:message}"',
			'# Exemplo: "{MEMORY:O nome do usuário é Pedro}"',
			'# Se um usuário pedir para que você o lembre de algo daqui a algum tempo, você deve criar um alarme com uma mensagem MUITO engraçada',
			'# Use apenas durações relativas: anos (y), meses (mo), semanas (w), dias (d), horas (h), minutos (m) ou segundos (s)',
			'# Modelo de Alarme: "{ALARM:text:duration}"',
			'# Exemplo: "{ALARM:Desliga o forno senão vai explodir:1h}"',
			'Memórias do usuário:',
			...user.memories,
		],
	} as GenerateContentConfig
}

async function uploadFile(file: GoogleFile, msg: AIMsg) {
	/** Uploading file to Google File API (it's free)
	 * File API lets you store up to 20GB of files per project
	 * Limit: 2GB for each one
	 * Expiration: 48h
	 * Media cannot be downloaded from the API, only uploaded
	 */
	let upload = await GoogleAI.files.upload({
		file: new Blob([file.buffer as ArrayBuffer]),
		config: { mimeType: file.mime },
	})

	upload = await GoogleAI.files.get({ name: upload.name! }) // fetch its info
	while (upload.state === FileState.PROCESSING) { // media still processing
		// Sleep until it gets done
		await delay(2_000)
		// Fetch the file from the API again
		upload = await GoogleAI.files.get({ name: upload.name! })
	}

	// media upload failed
	if (upload.state === FileState.FAILED) throw new Error('Google server processing failed.')
	return upload // return the file info
}
