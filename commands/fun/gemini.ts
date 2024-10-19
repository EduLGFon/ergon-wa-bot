import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai'
import { Cmd, CmdCtx } from '../../map.js'

export default class extends Cmd {
	constructor() {
		super({
			aliases: ['g'],
			cooldown: 4,
		})
	}

	async run({ bot, msg, args, sendUsage }: CmdCtx) {
		if (!args[0]) return sendUsage()

		await bot.react(msg, '⌛')

		const model =
			(args[0] === 'pro' ? args.shift() && 'gemini-1.5-pro' : 'gemini-1.5-flash') as str
		// Access your API key as an environment variable
		const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY!)

		const safetySettings = [{
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
		}]

		// The Gemini 1.5 models are versatile and work with both text-only and multimodal prompts
		const gemini = genAI.getGenerativeModel({ model, safetySettings })
		const prompt = args.join(' ')
		let inputTokens, outputTokens
		let text

		try {
			if (msg.isMedia || msg?.quoted?.isMedia) {
				const target = msg.isMedia ? msg : msg.quoted
				const buffer = await bot.downloadMedia(target)

				const media = {
					inlineData: {
						data: Buffer.from(buffer).toString('base64'),
						mimeType: target.mime,
					},
				}

				inputTokens = (await gemini.countTokens([prompt, media])).totalTokens
				text = await gemini.generateContent([prompt, media])
			} else {
				inputTokens = (await gemini.countTokens(prompt)).totalTokens
				text = await gemini.generateContent(prompt)
			}

			text = text.response.text().replaceAll('**', '*')

			outputTokens = (await gemini.countTokens(text)).totalTokens
		} catch (e: any) {
			text = `Error: ${e.message}`
		}

		bot.send(
			msg,
			`${inputTokens} tokens to *${model}* (${outputTokens} tokens):\n${text.encode()}`,
		)
		bot.react(msg, '✅')
		return
	}
}
