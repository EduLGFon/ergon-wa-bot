import {
	EnhancedGenerateContentResponse,
	GenerateContentResult,
	GenerateContentStreamResult,
	GoogleGenerativeAI,
	HarmBlockThreshold,
	HarmCategory,
} from '@google/generative-ai'
import { aiPrompt, runner } from '../map.js'
// import { api } from '../map.js'
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
		const media = {
			inlineData: { // convert media buffer to base64
				data: Buffer.from(buffer).toString('base64'),
				mimeType: mime!,
			},
		}

		prompt = [prompt as str, media]
	}

	let interval
	let text = ''
	let result: GenerateContentStreamResult | GenerateContentResult
	let data: EnhancedGenerateContentResponse

	try {
		if (!callback) { // only return text when it's done
			result = await gemini.generateContent(instruction + prompt)

			text = result.response.text()

			return generateResponse(result.response)
		}
		user = user!

		// it's your conversation history
		user.geminiCtx = [{ role: 'user', parts: [{ text: instruction }] }, ...user.geminiCtx]

		/* Gemini dynamic chats:
		A new chat will be created every time gemini() is called
		it's useful to change model and keep 'AI memory' (history context)

		it also allows to use dynamic initial instructions, so Gemini language
		can be switched as bot user language.
		*/
		const chat = gemini.startChat({ history: user.geminiCtx })
		result = await chat.sendMessageStream(prompt)

		user.geminiCtx = await chat.getHistory() // save history
		user.geminiCtx.shift() // remove initial instruction from history

		// edit msg every 1s with new generated words
		interval = setInterval(() => callback(generateResponse(data)), 1_000)

		for await (const chunk of result.stream) {
			data = chunk // save new generated text
			text += chunk.text()
		}

		data = await result.response
		text = data.text() // get final text
	} catch (e: any) {
		text = e.message.encode()
		console.error(e)
	} finally {
		clearInterval(interval)
		// @ts-ignore last time editing msg
		if (callback) callback(generateResponse(data))
	}

	function generateResponse(chunk?: EnhancedGenerateContentResponse) {
		return {
			model, // AI Model
			reason: chunk?.candidates![0]?.finishReason || 'no reason',
			text: text.replaceAll('**', '*').replaceAll('##', '>'),
			inputSize: chunk?.usageMetadata?.promptTokenCount || 0, // input tokens count
			tokens: chunk?.usageMetadata?.candidatesTokenCount || 0, // output tokens count
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
