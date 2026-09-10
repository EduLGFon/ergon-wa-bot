// bridge_jid_check - regression check for group/DM alias separation.
//
// Asserts group keys never yield sender aliases (the bug that routed group
// messages into DM topics) while DM LID<->PN merging still works:
//
//   deno run -A scripts/bridge_jid_check.ts
import { altJidsOf, candidatesOf, pickCanonical } from '../bridge/wa-to-tg/jid.ts'

function assert(cond: boolean, msg: string): void {
	if (!cond) throw new Error(`FAIL: ${msg}`)
	console.log(`ok: ${msg}`)
}

function run(): void {
	const groupKey = {
		remoteJid: '120363428196769118@g.us',
		remoteJidAlt: null,
		participant: '76424815861953@lid',
		participantAlt: '5527999719338@s.whatsapp.net',
	}
	assert(altJidsOf(groupKey).length === 0, 'group altJidsOf ignores participantAlt')
	assert(
		candidatesOf(groupKey).join(',') === '120363428196769118@g.us',
		'group candidatesOf returns group only',
	)
	const dmKey = {
		remoteJid: '76424815861953@lid',
		remoteJidAlt: '5527999719338@s.whatsapp.net',
		participantAlt: null,
	}
	const dmAlts = altJidsOf(dmKey)
	assert(dmAlts.includes('5527999719338@s.whatsapp.net'), 'DM keeps PN alt')
	assert(
		pickCanonical('76424815861953@lid', dmAlts) === '5527999719338@s.whatsapp.net',
		'PN wins canonical',
	)
	const dmCands = candidatesOf({ ...dmKey, participant: null })
	assert(dmCands.includes('5527999719338@s.whatsapp.net'), 'DM candidates keep PN')
	console.log('All jid checks passed.')
}

try {
	run()
} catch (e) {
	console.error(e instanceof Error ? e.message : e)
	Deno.exit(1)
}
