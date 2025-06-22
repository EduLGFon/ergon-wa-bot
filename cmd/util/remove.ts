import { Cmd, CmdCtx, defaults, emojis, isVisual, runCode } from '../../map.js'
import { getMedia } from '../../util/messages.js'
import { readFile, writeFile } from 'fs/promises'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['rm'],
			cooldown: 5_000,
		})
	}

	async run({ msg, startTyping, send, t }: CmdCtx) {
		let media = await getMedia(msg)

		if (!media) return send(t('sticker.nobuffer'))
		await startTyping()

		const file = await writeFile(
			defaults.runner.tempFolder + `sticker_${Date.now()}.webp`,
			media.data,
		)
		// create temporary file

		// execute python background remover plugin on
		await runCode('py', `${file} ${file}.png`, 'plugin/removeBg.py')
		// a child process

		const buffer = await readFile(`${file}.png`) || media.data
		// read new file

		send({ caption: emojis['sparkles'], image: buffer })
		return
	}
}
