import {
	EnhancedGenerateContentResponse,
	GenerateContentStreamResult,
	GoogleGenerativeAI,
	HarmBlockThreshold,
	HarmCategory,
	Part,
} from '@google/generative-ai'
import { aiPrompt, runner } from '../map.js'
// import { api } from '../map.js'
// import OpenAI from 'openai'

export { gemini, imgRemover, runCode }

async function runCode(data: { lang?: str; code?: str; file?: str }) {
	const req = await fetch(`http://localhost:${runner.port}/run`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(data),
	})

	return await req.text()
}

async function imgRemover(img: str, quality: number) {
	const req = await fetch(`http://localhost:${runner.port}/remover`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ img, quality }),
	})

	return await req.json()
}

async function gemini({ prompt, model, buffer, mime, user, callback }: aiPrompt) {
	// Access your API key as an environment variable
	const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY!)

	// The Gemini 1.5 models are versatile and work with both text-only and multimodal prompts
	const gemini = genAI.getGenerativeModel({
		model,
		safetySettings: [{
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

	let result: GenerateContentStreamResult
	let text = ''

	if (buffer) {
		const media = {
			inlineData: {
				data: Buffer.from(buffer).toString('base64'),
				mimeType: mime!,
			},
		}

		prompt = [prompt as str, media]
	}

	try {
		if (!user._chat) {
			user._chat = gemini.startChat({
				history: [
					{
						role: 'user',
						parts: [{
							text:
								`Create a short, concise answer and, only if necessary, a long, detailed one. Always answer in ${user.lang} and use bold for all important words and keywords.`,
						}],
					},
				],
			})
		}
		result = await user._chat.sendMessageStream(prompt)

		for await (const chunk of result.stream) {
			text += chunk.text()
			callback(generateResponse(chunk))
		}
		const response = await result.response
		return callback(generateResponse(response))
	} catch (e: any) {
		text = `Error: ${e.message.encode()}`
		print(text)
	}

	function generateResponse(chunk: EnhancedGenerateContentResponse) {
		return {
			model,
			reason: chunk.candidates![0].finishReason || '',
			text: text.replaceAll('**', '*').replaceAll('##', '>'),
			inputSize: chunk.usageMetadata?.promptTokenCount || 0,
			tokens: chunk.usageMetadata?.candidatesTokenCount || 0,
		} as aiResponse
	}
	return
}

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
