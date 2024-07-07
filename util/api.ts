import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory, Part } from '@google/generative-ai'
import { runner } from '../map.js'
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

interface aiPrompt {
	preprompt: str
	content: str
	model: str
	buffer?: Buffer
	mime?: str
}
async function gemini({ preprompt, content, model, buffer, mime }: aiPrompt) {
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

	let prompt: str | [str, Part] = preprompt + content
	let tokens = [] // tokens[1] = prompt tokens; tokens[2] = response tokens
	let request, response: str

	if (buffer) {
		const media = {
			inlineData: {
				data: Buffer.from(buffer).toString('base64'),
				mimeType: mime!,
			},
		}

		prompt = [prompt, media]
	}

	try {
		tokens[0] = await gemini.countTokens(preprompt)
		tokens[1] = await gemini.countTokens(content)
		request = await gemini.generateContent(prompt)

		response = request.response.text()
		tokens[2] = await gemini.countTokens(response)
	} catch (e: any) {
		response = `Error: ${e.message.encode()}`
	}

	return {
		model,
		response: response.replaceAll('**', '*'),
		tokens: [tokens[0].totalTokens, tokens[1].totalTokens, tokens[2].totalTokens],
	}
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
