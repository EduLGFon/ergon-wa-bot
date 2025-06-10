import { FileMetadataResponse, FileState, GoogleAIFileManager } from '@google/generative-ai/server'
import { defaults, delay, makeTempFile, User } from '../map.js'
import {
	GenerateContentResult,
	GoogleGenerativeAI,
	HarmBlockThreshold,
	HarmCategory,
} from '@google/generative-ai'
// import OpenAI from 'openai'

export { gemini, xAI }

async function gemini(
	{ instruction, prompt, model, buffer, mime, user }: aiPrompt,
): Promise<aiResponse> {
	// Access your API key as an environment variable
	const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY!)
	const fileManager = new GoogleAIFileManager(process.env.GEMINI_KEY!)

	let file: FileMetadataResponse // Prompt file
	let result: GenerateContentResult // AI Result

	const gemini = genAI.getGenerativeModel({
		model: model || defaults.ai.gemini,
		safetySettings: [{ // won't block any potential dangerous content
			category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
			threshold: HarmBlockThreshold.BLOCK_NONE,
		}, {
			category: HarmCategory.HARM_CATEGORY_HARASSMENT,
			threshold: HarmBlockThreshold.BLOCK_NONE,
		}, {
			category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
			threshold: HarmBlockThreshold.BLOCK_NONE,
		}, {
			category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
			threshold: HarmBlockThreshold.BLOCK_NONE,
		}],
		systemInstruction: instruction,
	})

	if (buffer) { // include media buffer with text prompt
		// Writing buffer as a temporary file
		const fileName = await makeTempFile(buffer, 'gemini_')

		/** Uploading file to Google File API (it's free)
		 * File API lets you store up to 20GB of files per project
		 * Limit: 2GB for each one
		 * Expiration: 48h
		 * Media cannot be downloaded from the API, only uploaded
		 */
		const upload = await fileManager.uploadFile(fileName, { mimeType: mime! })

		file = await fileManager.getFile(upload.file.name) // fetch its info
		while (file.state === FileState.PROCESSING) { // media still processing
			// Sleep until it gets done
			await delay(3_000)
			// Fetch the file from the API again
			file = await fileManager.getFile(upload.file.name)
		}
		// media upload failed
		if (file.state === FileState.FAILED) throw new Error('Media processing failed.')

		const media = {
			fileData: {
				mimeType: upload.file.mimeType,
				fileUri: upload.file.uri,
			},
		}

		prompt = [media, prompt as str]
	}

	if (!user) { // only return text when it's done
		// if (typeof prompt === 'string') prompt = instruction + prompt
		// else prompt[1] = instruction + prompt // if it has media

		result = await gemini.generateContent(prompt)

		return { text: result.response.text() }
	}

	/** Gemini dynamic chats:
	 * A new chat will be created every time gemini() is called
	 * it's useful to change model and keep 'AI memory' (history context)
	 * it also allows to use dynamic initial instructions, so Gemini language
	 * can be switched as bot user language.
	 */
	const chat = gemini.startChat({ history: user.geminiCtx })
	result = await chat.sendMessage(prompt)

	user.geminiCtx = await chat.getHistory()

	return {
		text: result.response!.text().replaceAll('**', '*').replaceAll('##', '>'),
		tokens: result.response?.usageMetadata?.promptTokenCount || 0,
		// input + context tokens count
	}
}

async function xAI(user: User, prompt: str) {
	if (!user.grok) user.grok = []

	user.grok.push({ role: 'user', content: prompt })
	let data = {
		messages: user.grok,
		model: 'grok-beta',
		stream: false,
		temperature: 0,
	}

	const req = await fetch('https://api.x.ai/v1/chat/completions', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${process.env.XAI}`,
		},
		body: JSON.stringify(data),
	})

	const response = await req.json()

	const message = response.choices[0].message
	delete message.refusal

	user.grok.push(message)
	return message.content
}

// GPT is not supported anymore
// async function gpt({ content, model }: aiPrompt) {
// 	print(model)
// 	print(content)
// 	let response

// 	try {
// 		const openai = new OpenAI()
// 		print(openai)

// 		const completion = await openai.chat.completions.create({
// 			messages: [{ role: 'system', content }],
// 			model,
// 		})
// 		console.log(completion)

// 		response = completion.choices[0]
// 	} catch (e: any) {
// 		response = `Error: ${e.message.encode()}`
// 	}

// 	return {
// 		model,
// 		response,
// 	}
// }

// export const models = {
// 	async gem(prompt: aiPrompt) {
// 		prompt.model = api.aiModel.gemini
// 		return await gemini(prompt)
// 	},
// 	async pro(prompt: aiPrompt) {
// 		prompt.model = api.aiModel.geminiPro
// 		return await gemini(prompt)
// 	},
// 	async gpt(prompt: aiPrompt) {
// 		prompt.model = api.aiModel.gpt
// 		return await gpt(prompt)
// 	},
// }
