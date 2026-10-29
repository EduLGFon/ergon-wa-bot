// Profile picture change events - contacts.update fan-out in one place.
//
// Baileys emits contacts.update with imgUrl changed/removed for both DM
// avatars and group icons. Each mapped chat re-syncs its pinned profile
// card (fresh fetch plus about/desc snapshot). Unknown or paused chats
// stay silent. Never throws - one bad chat never blocks the rest.
import { relayCtx } from './state.ts'
import { syncProfileCard } from './profile.ts'
import bot from '@plugin/bot.ts'

export async function handleProfilePictureChange(
	updates: { id?: string; imgUrl?: string | null }[],
): Promise<void> {
	const { db } = relayCtx
	if (!db) return
	for (const u of updates || []) {
		try {
			if (!u || typeof u.id !== 'string' || !u.id) continue
			// Never mirror our own avatar/group icon changes back into our
			// own topics - the peer's card is what matters.
			const selfIds = [
				bot.sock?.user?.id,
				bot.sock?.user?.lid,
				bot.lid,
			].filter(Boolean)
			const selfPhones = selfIds.map((x) => String(x).split('@')[0].split(':')[0])
			const uidPhone = String(u.id).split('@')[0].split(':')[0]
			if (selfIds.includes(u.id) || selfPhones.includes(uidPhone)) continue
			if (u.imgUrl !== 'changed' && u.imgUrl !== 'removed') continue
			const mapping = db.getByJidOrAlias(u.id)
			if (!mapping || mapping.archived || mapping.muted) continue
			await syncProfileCard({
				jid: mapping.whatsapp_jid,
				displayName: mapping.display_name,
				chatType: mapping.chat_type,
				isGroup: mapping.whatsapp_jid.endsWith('@g.us'),
				topicId: mapping.telegram_topic_id,
				chatId: mapping.telegram_chat_id,
			})
		} catch (e) {
			console.error('[BRIDGE] profile change relay failed:', e)
		}
	}
}
