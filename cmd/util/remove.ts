import { Cmd, type CmdCtx, defaults, emojis, runCode } from '../../map.ts'
import { getMedia } from '../../util/msgAbstractions.ts'
import { readFile, unlink, writeFile } from 'node:fs/promises'

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
		await writeFile(path, media.buffer)
		// create temporary file
		await runCode('py', `${path} ${path}.png`, 'plugin/removeBg.py')
		// execute python background remover plugin on
		// a child process

		const buffer = (await readFile(`${path}.png`)) || media.buffer
		// read new file, then cleanup temp files
		await unlink(path).catch(() => {})
		await unlink(`${path}.png`).catch(() => {})

		send({ caption: emojis['sparkles'], image: buffer }, { quoted: msg })
	}
}
