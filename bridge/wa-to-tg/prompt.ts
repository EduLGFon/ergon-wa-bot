// New-chat classification prompt - Personal/Business buttons.
//
// A chat with an undecided bucket relays into the default (personal)
// group; the first relay then posts this prompt in its topic so the owner
// taps once instead of typing a command. Button taps resolve the chat
// through the stored prompt message ID (callback payloads cap at 64
// bytes). Single-group setups never prompt - there is nowhere to move to.
import { isQueueDrop } from '../rate-limiter.ts'
import { isDual } from './routing.ts'
import { relayCtx, tgCall } from './state.ts'
import { InlineKeyboard } from 'grammy'

export function classificationKeyboard(): InlineKeyboard {
	return new InlineKeyboard()
		.text('👤 Personal', 'bucket:personal')
		.text('💼 Business', 'bucket:business')
}

export function classificationText(displayName: string): string {
	return `New chat: ${displayName}\nPersonal or business?`
}

// Post the prompt once per chat - never throws, never blocks relay.
export async function maybePromptClassification(
	jid: string,
	chatId: string,
	topicId: number,
	displayName: string,
): Promise<void> {
	const { db, tg, groups } = relayCtx
	if (!db || !tg || !isDual(groups)) return
	try {
		const mapping = db.getByJidOrAlias(jid)
		if (!mapping || mapping.archived || mapping.muted) return
		if (mapping.bucket !== 'undecided' || mapping.prompt_msg_id) return
		if (chatId !== groups.personal) return
		const sent = await tgCall(
			() =>
				tg!.api.sendMessage(chatId, classificationText(displayName), {
					message_thread_id: topicId,
					reply_markup: classificationKeyboard(),
				}),
			'prompt',
		)
		if (sent?.message_id) db.setPromptMsgId(jid, sent.message_id)
	} catch (e) {
		// Load-shed drops during deep backlogs are intentional - stay silent.
		if (isQueueDrop(e)) return
		console.error('[BRIDGE] classification prompt failed:', e)
	}
}
