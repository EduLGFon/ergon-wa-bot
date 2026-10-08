// Start a bridged chat from Telegram: `/new <phone> [name]`.
//
// Split from commands.ts so each file stays under the size budget.
// Verifies the number on WhatsApp, creates the forum topic + mapping -
// the first message written in that topic relays like any other. A chat
// born in a group inherits that group's bucket, so no prompt follows.
import { bucketOfChat, type GroupIds } from '../wa-to-tg/routing.ts'
import { normalizeJid } from '../wa-to-tg/jid.ts'
import type { InSupergroup, TgCall } from './commands.ts'
import type { BridgeDB } from '../db.ts'
import type { Bot } from 'grammy'
import bot from '@plugin/bot.ts'

export function registerNewCommand(
	tg: Bot,
	db: BridgeDB,
	tgCall: TgCall,
	inSupergroup: InSupergroup,
	groups: GroupIds,
): void {
	tg.command('new', async (ctx) => {
		try {
			if (!inSupergroup(ctx)) return
			if (ctx.from?.is_bot) return
			const chatId = String(ctx.chat.id)
			const args = ((ctx.match as string) || '').trim().split(/\s+/)
			const digits = (args[0] || '').replace(/\D/g, '')
			if (!digits || digits.length < 7 || digits.length > 15) {
				await ctx.reply(
					'Usage: /new <phone number> [name]\nExample: /new 15551234567 Alice',
				)
				return
			}
			const jid = `${digits}@s.whatsapp.net`
			const existing = db.getByJidOrAlias(jid)
			if (existing && !existing.archived) {
				await ctx.reply(
					`+${digits} is already bridged in topic #${existing.telegram_topic_id}.`,
				)
				return
			}
			const lookup = await bot.sock.onWhatsApp(jid).catch((): {
				jid: string
				exists: boolean
			}[] => [])
			const info = lookup?.[0]
			if (!info?.exists) {
				await ctx.reply(`No WhatsApp account found for +${digits}.`)
				return
			}
			// The server may address this contact under a LID elsewhere -
			// remember the verified JID as an alias of the canonical PN.
			try {
				const verified = normalizeJid((info as { jid?: string }).jid)
				if (verified) db.addAlias(verified, jid)
			} catch {
				// Best effort - the WA side heals the alias on first sight.
			}
			const name = (args.slice(1).join(' ') || `+${digits}`).replace(/[\n\r]+/g, ' ').trim()
				.slice(0, 128) || `+${digits}`
			const topic = await tgCall(
				() => tg.api.createForumTopic(chatId, name),
				'new-topic',
				chatId,
			)
			db.getOrCreate(jid, topic.message_thread_id, name, '1:1', chatId)
			const bucket = bucketOfChat(chatId, groups)
			if (bucket) db.setBucket(jid, bucket)
			await ctx.reply(
				`Bridged +${digits} → topic #${topic.message_thread_id}. Write there to send.`,
			)
		} catch (e) {
			console.error('[BRIDGE] TG→WA /new failed:', e)
		}
	})
}
