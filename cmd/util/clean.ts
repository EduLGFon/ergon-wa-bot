// Clean command - bulk deletes recent group msgs for admins only
// Needed to moderate spam and keep groups tidy
import { delay, isValidPositiveIntenger, randomDelay } from '@util/functions.ts'
import { type CmdCtx } from '@conf/types/types.d.ts'
import Cmd from '@class/cmd.ts'

// Anti rate-limit pacing: WhatsApp answers 429 `rate-overlimit` on
// sustained bursts (seen in prod from the per-send groupMetadata query).
// ~1 delete per 2s plus a breather every 10 keeps us under the window.
const DELETE_PACING_MIN_MS = 1_500
const DELETE_PACING_MAX_MS = 2_500
const BREATHER_EVERY = 10
const BREATHER_MS = 5_000
// On 429: wait this long before retrying the same msg, a few times, then
// stop gracefully instead of aborting with a raw error dumped in chat.
const RATE_LIMIT_WAIT_MS = 30_000
const RATE_LIMIT_RETRIES = 3

// True when Baileys failed with WhatsApp's 429 slow-down (Boom shape seen
// in prod: data 429 with an "Error: rate-overlimit" message).
export function isRateLimitError(e: unknown): bool {
	try {
		const anyErr = e as { data?: unknown; message?: unknown; description?: unknown }
		if (anyErr?.data === 429) return true
		const msg = typeof anyErr?.message === 'string' ? anyErr.message : ''
		const desc = typeof anyErr?.description === 'string' ? anyErr.description : ''
		return msg.includes('rate-overlimit') || desc.includes('rate-overlimit') ||
			msg.includes('rate limit') || desc.includes('rate limit')
	} catch {
		return false
	}
}

export default class extends Cmd {
	constructor() {
		super({
			cooldown: 10_000,
			access: {
				groups: true,
				dm: false,
				admin: true,
				botAdmin: true,
			},
			subCmds: ['reverse'],
		})
	}

	async run({ msg, args, send, user, group, t }: CmdCtx) {
		group = group!
		let disclaimerMsgCtx: CmdCtx | undefined
		const amount = Number(args[0]) // amount of msgs to be deleted for everyone-

		if (amount === 0) return send(t('clean.noAmount'))

		if (!isValidPositiveIntenger(amount)) return send('usage.clean', { user })

		// the bot can only delete up to 200 msgs bc thats the max msgs that can be cached
		if (group.msgs.size < amount) {
			// send a disclaimer msg that only x msgs can be deleted
			disclaimerMsgCtx = await send(t('clean.deleted', { msgsSize: group.msgs.size }))
		}

		let msgs = group.msgs
			.reverse() // reverse to delete newest msgs first
			.slice(1, amount + 1)

		if (this.subCmds[0] === args[1]) msgs = msgs.reverse()
		// it will delete oldest msgs first

		const cleanDisclaimer = async () => {
			if (!disclaimerMsgCtx) return
			// delete disclaimer msg
			await send.bind(disclaimerMsgCtx.msg)({
				delete: disclaimerMsgCtx.msg.key,
			})
			group.msgs.delete(disclaimerMsgCtx.msg.key.id!)
		}

		let deleted = 0
		const total = msgs.length

		for (const i in msgs) {
			// breather every 10 deletes to stay under WhatsApp's rate window
			if (Number(i) % BREATHER_EVERY === 0 && i !== '0') await delay(BREATHER_MS)

			const target = msgs[i]
			let rateLimited = false

			for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt++) {
				try {
					// delete msg for everyone
					await send.bind(target.chat)({ delete: target.key })
					deleted++
					break
				} catch (e) {
					if (!isRateLimitError(e)) break // not throttling: skip this msg
					if (attempt === RATE_LIMIT_RETRIES) {
						rateLimited = true
						break
					}
					// throttled: back off, then retry the same msg
					await delay(RATE_LIMIT_WAIT_MS)
				}
			}

			// delete it from cache either way so one bad msg never poisons future cleans
			group.msgs.delete(target.key.id!)

			if (rateLimited) {
				// WhatsApp is throttling us: stop here and tell the admin to
				// resume later instead of hammering the rate limit further.
				try {
					await cleanDisclaimer()
					await send(t('clean.slowed', { deleted, total }))
				} catch {
					// still throttled: nothing more to do, the run just ends
				}
				return
			}

			// human-like pacing between deletes to avoid the next rate limit
			await randomDelay(DELETE_PACING_MIN_MS, DELETE_PACING_MAX_MS)
		}

		await cleanDisclaimer()

		await send.bind(msg)({ delete: msg.key }) // delete cmd msg
		group.msgs.delete(msg.key.id!)
	}
}
