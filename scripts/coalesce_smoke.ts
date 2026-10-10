// coalesce_smoke - targeted checks for burst joining (see DECISIONS.md#D11).
//
// Exercises the pure helpers only (join math, eligibility, service lines):
// no Telegram/WhatsApp network, no bridge DB.
//
//   deno run -A scripts/coalesce_smoke.ts
import { canCoalesceText, joinParts } from '../plugin/bridge/wa-to-tg/coalesce.ts'
import { serviceLines } from '../plugin/bridge/wa-to-tg/service-batch.ts'
import { canCoalesceTg } from '../plugin/bridge/tg-to-wa/coalesce.ts'

let failures = 0
function check(name: string, cond: boolean): void {
	if (!cond) {
		failures++
		console.error(`FAIL: ${name}`)
	} else console.log(`ok: ${name}`)
}

// Joined body keeps one label; entities rebase past earlier parts.
const joined = joinParts('Ana: ', [
	{ text: 'hi', entities: [] },
	{ text: 'how are you', entities: [{ type: 'bold', offset: 8, length: 3 }] },
])
check('join body', joined.body === 'Ana: hi\nhow are you')
check(
	'join entity offset',
	joined.entities.length === 1 && joined.entities[0].offset === 16 &&
		joined.entities[0].length === 3,
)
check('join single part', joinParts('You: ', [{ text: 'x', entities: [] }]).body === 'You: x')

// WA-to-TG eligibility: plain texts only.
check('wa text joins', canCoalesceText(null, null, 'hello'))
check('wa media skips', !canCoalesceText({ kind: 'image' }, null, 'hi'))
check('wa special skips', !canCoalesceText(null, { kind: 'poll' }, 'hi'))
check('wa blank skips', !canCoalesceText(null, null, '   '))

// TG-to-WA eligibility: plain texts only, never replies or commands.
const base = { message_id: 1, from: { id: 9 } }
check('tg text joins', canCoalesceTg({ ...base }, 'hello', null))
check(
	'tg reply skips',
	!canCoalesceTg({ ...base, reply_to_message: { message_id: 2 } }, 'hi', null),
)
check('tg command skips', !canCoalesceTg({ ...base }, '/topics', null))
check('tg media skips', !canCoalesceTg({ ...base }, 'hi', { kind: 'image' }))
check('tg poll skips', !canCoalesceTg({ ...base, poll: { id: 'p' } }, 'hi', null))
check('tg location skips', !canCoalesceTg({ ...base, location: {} }, 'hi', null))
check('tg dice skips', !canCoalesceTg({ ...base, dice: {} }, 'hi', null))

// Service lines: one line per bucket, silent unless an admin change rides.
const mixed = serviceLines({ adds: ['+a'], removes: [], promotes: ['+b'], demotes: [] })
check('service mixed body', mixed.body === '👋 +a joined the group\n⭐ +b is now an admin')
check('service mixed notifies', mixed.silent === false)
const quiet = serviceLines({ adds: ['+a', '+b'], removes: ['+c'], promotes: [], demotes: [] })
check(
	'service quiet body',
	quiet.body === '👋 +a, +b joined the group\n🚪 +c left the group',
)
check('service quiet silent', quiet.silent === true)
check(
	'service empty',
	serviceLines({ adds: [], removes: [], promotes: [], demotes: [] }).body === '',
)

if (failures > 0) {
	console.error(`${failures} check(s) failed`)
	Deno.exit(1)
}
console.log('all coalesce smokes passed')
