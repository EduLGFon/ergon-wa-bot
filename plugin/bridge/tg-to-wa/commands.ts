// Telegram command handlers - topic admin commands.
// All tg.command registrations - message handlers stay in facade.
import type { BridgeDB } from '../db.ts'
import { Bot } from 'grammy'

export type TgCall = <T>(
	fn: () => Promise<T>,
	label?: string,
	chatId?: string | number,
) => Promise<T>
export type InSupergroup = (ctx: { chat?: { id?: string | number } }) => boolean

export function registerTgCommands(
	tg: Bot,
	db: BridgeDB,
	inSupergroup: InSupergroup,
): void {
	tg.command('start', async (ctx) => {
		if (!inSupergroup(ctx)) return
		await ctx.reply('WhatsApp bridge is active. Each WhatsApp chat mirrors to its own topic.')
	})

	tg.command('id', async (ctx) => {
		await ctx.reply(
			`Supergroup ID: \`${ctx.chat.id}\`\nSet it as TELEGRAM_SUPERGROUP_PERSONAL or TELEGRAM_SUPERGROUP_BUSINESS in conf/.env.`,
			{ parse_mode: 'Markdown' },
		)
	})

	tg.command('topics', async (ctx) => {
		if (!inSupergroup(ctx)) return
		const topics = db.getAllActive()
		const msg = topics.map((t) =>
			`${t.display_name} (${t.whatsapp_jid}) -> topic #${t.telegram_topic_id} [${t.bucket}]`
		).join('\n')
		await ctx.reply(msg || 'No active topics yet.')
	})

	tg.command('archive', async (ctx) => {
		if (!inSupergroup(ctx)) return
		const topicId = (ctx.msg as any)?.message_thread_id
		if (!topicId) return
		const mapping = db.getByTopic(String(ctx.chat.id), topicId)
		if (mapping) {
			db.archive(mapping.whatsapp_jid)
			await ctx.reply(`Archived bridge for ${mapping.display_name} (mapping kept)`)
		}
	})

	// Alias kept for backwards compatibility.
	tg.command('close', async (ctx) => {
		if (!inSupergroup(ctx)) return
		const topicId = (ctx.msg as any)?.message_thread_id
		if (!topicId) return
		const mapping = db.getByTopic(String(ctx.chat.id), topicId)
		if (mapping) {
			db.archive(mapping.whatsapp_jid)
			await ctx.reply(`Closed bridge for ${mapping.display_name} (mapping kept)`)
		}
	})

	tg.command('reopen', async (ctx) => {
		if (!inSupergroup(ctx)) return
		const topicId = (ctx.msg as any)?.message_thread_id
		if (!topicId) return
		const all = db.getAll().find((t) =>
			t.telegram_topic_id === topicId && String(t.telegram_chat_id) === String(ctx.chat.id)
		)
		if (all) {
			db.unarchive(all.whatsapp_jid)
			await ctx.reply(`Reopened bridge for ${all.display_name}`)
		}
	})

	// Per-chat mute: /mute stops relay in both directions for this topic
	// (mapping kept, history untouched); /unmute resumes.
	tg.command('mute', async (ctx) => {
		if (!inSupergroup(ctx)) return
		const topicId = (ctx.msg as any)?.message_thread_id
		if (!topicId) return
		const mapping = db.getByTopic(String(ctx.chat.id), topicId)
		if (mapping) {
			db.setMuted(mapping.whatsapp_jid, true)
			await ctx.reply(`Muted ${mapping.display_name} - nothing relays until /unmute.`)
		}
	})

	tg.command('unmute', async (ctx) => {
		if (!inSupergroup(ctx)) return
		const topicId = (ctx.msg as any)?.message_thread_id
		if (!topicId) return
		// Muted mappings are still returned by getByTopic (only archived
		// ones are filtered), so this resolves the same row /mute set.
		const mapping = db.getByTopic(String(ctx.chat.id), topicId)
		if (mapping) {
			db.setMuted(mapping.whatsapp_jid, false)
			await ctx.reply(`Unmuted ${mapping.display_name} - relay resumed.`)
		}
	})
}
