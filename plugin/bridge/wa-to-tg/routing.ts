// Dual-supergroup routing - which Telegram group hosts a chat.
//
// Personal and business chats live in separate forum supergroups served by
// the same bot. TELEGRAM_SUPERGROUP_PERSONAL/_BUSINESS configure them;
// both fall back to the legacy TELEGRAM_SUPERGROUP_ID, so an unmigrated
// setup keeps working as one group (personal === business = single mode).
import type { Bucket, MappingRow, ReplyMapRow } from '../db.ts'

export interface GroupIds {
	personal: string
	business: string
	legacy: string
}

export function groupIds(): GroupIds {
	const legacy = Deno.env.get('TELEGRAM_SUPERGROUP_ID') ?? ''
	const personal = Deno.env.get('TELEGRAM_SUPERGROUP_PERSONAL') || legacy
	const business = Deno.env.get('TELEGRAM_SUPERGROUP_BUSINESS') || legacy
	return { personal, business, legacy }
}

// True once the operator points the two buckets at different groups.
export function isDual(ids: GroupIds): boolean {
	return !!ids.personal && !!ids.business && ids.personal !== ids.business
}

// Home group for a bucket - undecided chats start in personal.
export function chatOfBucket(bucket: Bucket, ids: GroupIds): string {
	return bucket === 'business' ? ids.business : ids.personal
}

// Which bucket a Telegram group hosts (null outside both groups).
export function bucketOfChat(chatId: string | number, ids: GroupIds): Bucket | null {
	const id = String(chatId)
	if (id && id === ids.business) return 'business'
	if (id && id === ids.personal) return 'personal'
	return null
}

// Group a mapping's topic lives in - legacy rows predate the column.
export function chatForMapping(
	mapping: Pick<MappingRow, 'telegram_chat_id'>,
	ids: GroupIds,
): string {
	return mapping.telegram_chat_id || ids.personal
}

// Group a mirrored reply row lives in - rows stamped before the move
// carry their own group, older ones fall back to their chat's mapping.
export function chatForReply(
	target: Pick<ReplyMapRow, 'tg_chat_id'>,
	mapping: Pick<MappingRow, 'telegram_chat_id'>,
	ids: GroupIds,
): string {
	return target.tg_chat_id || chatForMapping(mapping, ids)
}
