// Watches messages.update for REVOKE (delete-for-everyone) events and
// archives the original cached message to disk for the gotcha command.
import { findCachedOriginal, promotePendingDelete, saveDeleted } from '@plugin/deletedStore.ts'
import type { WAMessageUpdate } from 'baileys'

// Baileys emits REVOKE deletes here with update.message === null and
// update.messageStubType === 1 (StubType.REVOKE). Other updates
// (edits, polls, pins) are ignored.
export default async function (updates: WAMessageUpdate[], _event: str) {
	if (Deno.env.get('SHOW_IDS')) {
		print(
			'GOTCHA/update',
			(updates || []).map((u) => ({
				id: u.key?.id,
				chat: u.key?.remoteJid,
				stub: (u.update as any)?.messageStubType,
				nulled: (u.update as any)?.message === null,
			})),
			'blue',
		)
	}

	for (const { key, update } of updates || []) {
		const stub = (update as any)?.messageStubType
		const isRevoke = (update as any)?.message === null || stub === 1
		if (!isRevoke) continue

		const chat = key.remoteJid
		const deletedId = key.id
		if (!chat || !deletedId) continue

		try {
			const orig = findCachedOriginal(chat, deletedId)
			if (!orig) {
				// Original never cached: a stashed quote copy may exist - promote it.
				const rescued = await promotePendingDelete(chat, deletedId).catch(() => null)
				if (!rescued) {
					print('GOTCHA', `miss ${chat} ${deletedId} (original not in cache)`, 'yellow')
				}
				continue
			}
			if (orig.isBot) continue
			const saved = await saveDeleted(orig)
			if (!saved) print('GOTCHA', `dupe ${chat} ${deletedId} (already archived)`, 'yellow')
		} catch (e) {
			print('GOTCHA/update', (e as Error)?.message || e, 'red')
		}
	}
}
