// WA-TO-TG relay attach - hook shared socket events in one place.
//
// This never opens its own WhatsApp connection - a second Baileys socket
// would fight the main bot for the session, so all handlers piggyback on the
// running singleton and must attach AFTER loadEvents clears listeners.
import { handleGroupParticipants, handleGroupUpdates } from './chat.ts'
import type { RateLimiter } from '../rate-limiter.ts'
import { handleWaReactions } from './reactions.ts'
import { handleWaCalls } from './calls.ts'
import { relayCtx, setRelayCtx } from './state.ts'
import { handleWAMessages } from './incoming.ts'
import { handleWaDeletes } from './deletes.ts'
import { handleWaEdits } from './edits.ts'
import type { proto, WACallEvent } from 'baileys'
import type { BridgeDB } from '../db.ts'
import type { Bot } from 'grammy'
import bot from '@plugin/bot.ts'

export function attachWaRelay(tgBot: Bot, bridgeDb: BridgeDB, rateLimiter: RateLimiter): void {
	setRelayCtx(tgBot, bridgeDb, rateLimiter)
	if (relayCtx.attachedSock === bot.sock) return
	relayCtx.attachedSock = bot.sock

	// Additional listener on the SHARED socket - the core bot handler stays untouched.
	bot.sock.ev.on('messages.upsert', async (raw: { messages: proto.IWebMessageInfo[] }) => {
		try {
			await handleWAMessages(raw.messages)
		} catch (e) {
			console.error('[BRIDGE] WA-TO-TG handler failed:', e)
		}
	})
	// Reactions ride a separate event on the same shared socket. Attached
	// here (after loadEvents) for the same removeAllListeners reason.
	bot.sock.ev.on(
		'messages.reaction',
		async (reactions: { key: proto.IMessageKey; reaction: proto.IReaction }[]) => {
			try {
				await handleWaReactions(reactions)
			} catch (e) {
				console.error('[BRIDGE] WA-TO-TG reaction handler failed:', e)
			}
		},
	)
	// Edits arrive as `messages.update` (protocol MESSAGE_EDIT), not upsert -
	// the bridge previously ignored them, so WA edits never reached Telegram.
	bot.sock.ev.on(
		'messages.update',
		async (updates: { key: proto.IMessageKey; update: { message?: any } }[]) => {
			try {
				await handleWaEdits(updates)
			} catch (e) {
				console.error('[BRIDGE] WA-TO-TG edit handler failed:', e)
			}
		},
	)
	// Live call signaling on the same shared socket - each call id
	// collapses into one editable topic notice (see calls.ts).
	bot.sock.ev.on('call', async (calls: WACallEvent[]) => {
		try {
			await handleWaCalls(calls)
		} catch (e) {
			console.error('[BRIDGE] WA-TO-TG call handler failed:', e)
		}
	})
	// Group membership / subject changes -> service lines in the topic.
	bot.sock.ev.on('group-participants.update', async (upd: any) => {
		try {
			await handleGroupParticipants(upd)
		} catch (e) {
			console.error('[BRIDGE] WA-TO-TG group event failed:', e)
		}
	})
	// Local "delete for me" syncs -> delete the Telegram mirror too.
	// "Delete for everyone" revokes arrive as `messages.update` (REVOKE stub)
	// and are handled in handleWaEdits; the Bot API emits no event when a
	// Telegram message is deleted, so TG-TO-WA delete sync is impossible.
	bot.sock.ev.on('messages.delete', async (payload: any) => {
		try {
			await handleWaDeletes(payload)
		} catch (e) {
			console.error('[BRIDGE] WA-TO-TG delete handler failed:', e)
		}
	})
	bot.sock.ev.on('groups.update', async (updates: Partial<{ id: string; subject: string }>[]) => {
		try {
			await handleGroupUpdates(updates)
		} catch (e) {
			console.error('[BRIDGE] WA-TO-TG group update failed:', e)
		}
	})
	console.log('[BRIDGE] WA-TO-TG relay attached to the shared WhatsApp socket')
}
