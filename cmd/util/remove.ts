import defaults from '@conf/defaults.json' with { type: 'json' }
import { type CmdCtx } from '@conf/types/types.d.ts'
import { getMedia } from '@util/msgAbstractions.ts'
import runCode from '@plugin/runCode.ts'
import emojis from '@util/emojis.ts'
import Cmd from '@class/cmd.ts'
// migrated node:fs

export default class extends Cmd {
	constructor() {
		super({
			alias: ['rm'],
			cooldown: 5_000,
		})
	}

	async run({ msg, startTyping, send, t }: CmdCtx) {
		let media = await getMedia(msg)

		if (!media || !media.mime.includes('image')) return send(t('sticker.nobuffer'))
		await startTyping()

		const path = defaults.runner.tempFolder + `/rm_${Date.now()}.webp`
		await Deno.writeFile(path, media.buffer)
		// create temporary file
		await runCode('py', `${path} ${path}.png`, 'plugin/removeBg.py')
		// execute python background remover plugin on
		// a child process

		const buffer = (await Deno.readFile(`${path}.png`)) || media.buffer
		// read new file, then cleanup temp files
		await Deno.remove(path).catch(() => {})
		await Deno.remove(`${path}.png`).catch(() => {})

		send({ caption: emojis['sparkles'], image: buffer }, { quoted: msg })
	}
}
