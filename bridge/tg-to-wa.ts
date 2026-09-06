import { Bot } from 'grammy'
import { waSock } from './wa-to-tg.ts'
import { BridgeDB, type MappingRow } from './db.ts'
import { RateLimiter } from './rate-limiter.ts'

export function startTelegramBot(db: BridgeDB, rateLimiter: RateLimiter): Bot {
	const token = Deno.env.get('TELEGRAM_BOT_TOKEN')!
	const bot = new Bot(token)

	bot.command('start', async (ctx) => {
		await ctx.reply('🤖 WhatsApp Bridge Bot is active!')
	})

	bot.command('topics', async (ctx) => {
		const topics = db.getAllActive()
		const msg = topics.map((t) =>
			`📱 ${t.display_name} (${t.whatsapp_jid}) → Topic #${t.telegram_topic_id}`
		).join('\n')
		await ctx.reply(msg || 'No active topics yet.')
	})

	bot.command('archive', async (ctx) => {
		const topicId = ctx.msg.message_thread_id
		if (topicId) {
			const mapping = db.getByTopicId(topicId)
			if (mapping) {
				db.archive(mapping.whatsapp_jid)
				await ctx.reply(`Archived bridge for ${mapping.display_name}`)
			}
		}
	})

	bot.command('close', async (ctx) => {
		const topicId = ctx.msg.message_thread_id
		if (topicId) {
			const mapping = db.getByTopicId(topicId)
			if (mapping) {
				db.archive(mapping.whatsapp_jid)
				await ctx.reply(`Closed bridge for ${mapping.display_name} (mapping preserved)`)
			}
		}
	})

	bot.on('message', async (ctx) => {
		const topicId = ctx.msg.message_thread_id
		if (!topicId) return

		const mapping = db.getByTopicId(topicId)
		if (!mapping || mapping.archived) return

		const text = ctx.msg.text || ''
		const media = await getTelegramMedia(ctx)

		if (!text && !media) return

		await rateLimiter.enqueue(async () => {
			await relayToWhatsApp(mapping, text, media)
		}, topicId)
	})

	return bot
}

async function relayToWhatsApp(mapping: MappingRow, text: string, media: any) {
	if (!waSock) return
	let content: any = text ? { text } : undefined
	if (media && media.buffer) {
		content = mediaToWaContent(media)
	}
	await waSock.sendMessage(mapping.whatsapp_jid, content)
}

function mediaToWaContent(media: { type: string; buffer: Uint8Array }): any {
	switch (media.type) {
		case 'image':
			return { image: media.buffer }
		case 'video':
			return { video: media.buffer }
		case 'audio':
			return { audio: media.buffer }
		case 'sticker':
			return { sticker: media.buffer }
		case 'document':
			return { document: media.buffer }
		case 'voice':
			return { audio: media.buffer, ptt: true }
		default:
			return { document: media.buffer }
	}
}

async function getTelegramMedia(ctx: any): Promise<{ type: string; buffer: Uint8Array } | null> {
	try {
		if (ctx.msg.photo) {
			const file = await ctx.msg.photo[ctx.msg.photo.length - 1].getFile()
			const buffer = await file.download()
			return { type: 'image', buffer: new Uint8Array(buffer) }
		}
		if (ctx.msg.video) {
			const file = await ctx.msg.video.getFile()
			const buffer = await file.download()
			return { type: 'video', buffer: new Uint8Array(buffer) }
		}
		if (ctx.msg.audio) {
			const file = await ctx.msg.audio.getFile()
			const buffer = await file.download()
			return { type: 'audio', buffer: new Uint8Array(buffer) }
		}
		if (ctx.msg.document) {
			const file = await ctx.msg.document.getFile()
			const buffer = await file.download()
			return { type: 'document', buffer: new Uint8Array(buffer) }
		}
		if (ctx.msg.voice) {
			const file = await ctx.msg.voice.getFile()
			const buffer = await file.download()
			return { type: 'voice', buffer: new Uint8Array(buffer) }
		}
		if (ctx.msg.sticker) {
			const file = await ctx.msg.sticker.getFile()
			const buffer = await file.download()
			return { type: 'sticker', buffer: new Uint8Array(buffer) }
		}
	} catch {
		return null
	}
	return null
}
