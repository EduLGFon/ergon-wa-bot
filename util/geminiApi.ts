import {
	createPartFromUri,
	FileState,
	type GenerateContentConfig,
	type GenerateContentResponse,
	GoogleGenAI,
	ThinkingLevel,
} from '@google/genai'
import type { GoogleFile, Gparams } from '../conf/types/types.d.ts'
import { createMemories } from '../plugin/memories.ts'
import { createAlarms } from '../plugin/alarms.ts'
import { sendMsg } from './messages.ts'
import { delay, User } from '../map.ts'

// Initialize the Gemini client with the Studio API key.
const GoogleAI = new GoogleGenAI({ apiKey: process.env.GEMINI })

export default async function gemini({ input, user, msg, file, model }: Gparams) {
	const resBody = {
		header: '',
		text: '',
	}

	let upload
	if (file) upload = await uploadFile(file as GoogleFile)
	const prompt = upload ? [createPartFromUri(upload.uri!, upload.mimeType!), input] : input

	const gemini = GoogleAI.chats.create({
		model,
		config: getModelConfig(user),
		history: user.gemini,
	})

	const output = await gemini.sendMessage({ message: prompt })
	resBody.header = `- *${model}*:\n`

	await handleResponse(output, resBody)
	await createMemories(user, resBody)
	await createAlarms(user, resBody, msg!.chat)

	user.gemini = gemini.getHistory()

	return await sendMsg.bind(msg!.chat)(resBody.header + resBody.text.trim(), {
		quoted: msg
	})
}

async function handleResponse(chunk: GenerateContentResponse, msg: AIMsg) {
	if (chunk?.candidates) {
		let web = chunk.candidates[0]?.groundingMetadata?.webSearchQueries
		if (web) {
			let searches = ''
			if (web.length > 3) {
				searches =
					web
						.slice(0, 3)
						.map(s => s.encode())
						.join(', ') + ', `...`'
			} else {
				searches = web.map(s => s.encode()).join(', ')
			}
			msg.header += `- 🔍 ${searches}\n`
		}
	}
	if (chunk.text) msg.text += chunk.text
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
			'- Responda de forma clara e concisa por padrão. Para perguntas simples ou factuais, utilize no máximo 1–2 frases. Quando a pergunta envolver explicação, raciocínio, contexto técnico ou múltiplos passos, forneça primeiro um breve resumo e depois uma explicação mais detalhada. Evite prolixidade desnecessária, mas não sacrifique clareza ou precisão.',
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

async function uploadFile(file: GoogleFile) {
	/** Uploading file to Google File API (it's free)
	 * File API lets you store up to 20GB of files per project.
	 * Limit: 2GB for each one.
	 * Expiration: 48h.
	 * Media cannot be downloaded from the API, only uploaded.
	 */
	let upload = await GoogleAI.files.upload({
		file: new Blob([file.buffer as ArrayBuffer]),
		config: { mimeType: file.mime },
	})

	// The v2 SDK exposes `files.get` for metadata polling.
	upload = await GoogleAI.files.get({ name: upload.name! })
	while (upload.state === FileState.PROCESSING) {
		await delay(2_000)
		upload = await GoogleAI.files.get({ name: upload.name! })
	}

	if (upload.state === FileState.FAILED) {
		throw new Error('Google server processing failed.')
	}

	return upload
}
