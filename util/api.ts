import { FileMetadataResponse, FileState, GoogleAIFileManager } from '@google/generative-ai/server'
import { aiPrompt, delay, makeTempFile, runner } from '../map.js'
import {
	EnhancedGenerateContentResponse,
	GenerateContentResult,
	GenerateContentStreamResult,
	GoogleGenerativeAI,
	HarmBlockThreshold,
	HarmCategory,
} from '@google/generative-ai'
// import OpenAI from 'openai'

export { gemini, imgRemover, runCode }

async function runCode(data: { lang?: str; code?: str; file?: str }) {
	const req = await fetch(`http://localhost:${runner.port}/run`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})

	return await req.text()
}

async function imgRemover(img: str, quality: number) {
	const req = await fetch(`http://localhost:${runner.port}/remover`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ img, quality }),
	})

	return await req.json()
}

async function gemini({ instruction, prompt, model, buffer, mime, user, callback }: aiPrompt) {
	// Access your API key as an environment variable
	const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY!)
	const fileManager = new GoogleAIFileManager(process.env.GEMINI_KEY!)

	let interval // callback interval
	let text = '' // AI response text
	let file: FileMetadataResponse // Prompt file
	let result: GenerateContentStreamResult | GenerateContentResult // AI Result
	let data: EnhancedGenerateContentResponse // request data

	// The Gemini 1.5 models are versatile and work with both text-only and multimodal prompts
	const gemini = genAI.getGenerativeModel({
		model,
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

	try {
		if (!callback) { // only return text when it's done
			if (typeof prompt === 'string') prompt = instruction + prompt
			else prompt[1] = instruction + prompt // if it has media

			result = await gemini.generateContent(prompt)
			text = result.response.text()

			return generateResponse(result.response)
		}
		user = user! // user is not possibly undefined anymore at this point

		// it's your conversation history
		user.geminiCtx = [{ role: 'user', parts: [{ text: instruction }] }, ...user.geminiCtx]

		/** Gemini dynamic chats:
		 * A new chat will be created every time gemini() is called
		 * it's useful to change model and keep 'AI memory' (history context)
		 * it also allows to use dynamic initial instructions, so Gemini language
		 * can be switched as bot user language.
		 */
		const chat = gemini.startChat({ history: user.geminiCtx })
		result = await chat.sendMessageStream(prompt)

		user.geminiCtx = await chat.getHistory() // save history
		user.geminiCtx.shift() // remove initial instruction from history

		// edit msg every .5s with new generated words
		interval = setInterval(() => {
			if (data) callback(generateResponse(data))
		}, 500)

		for await (const chunk of result.stream) {
			data = chunk // save new generated text
			text += chunk.text()
		}

		data = await result.response
		text = data.text() // get final text
		clearInterval(interval) // stop interval
		// @ts-ignore last time editing msg
		callback(generateResponse(data, true))
	} catch (e: any) {
		clearInterval(interval) // stop interval
		throw new Error(e.message) // throw it again so
		// error will be handled by function that calls gemini()
	}

	function generateResponse(chunk?: EnhancedGenerateContentResponse, finish?: bool) {
		return {
			model, // AI Model
			text: text.replaceAll('**', '*').replaceAll('##', '>'),
			tokens: chunk?.usageMetadata?.promptTokenCount || 0,
			// input + context tokens count
			finish, // if it's the last chunk
		} as aiResponse
	}
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
