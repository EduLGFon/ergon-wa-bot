import { Cmd, CmdCtx, imgRemover } from '../../map.js'
import { writeFile } from 'fs/promises'
import axios from 'axios'

export default class extends Cmd {
	constructor() {
		super({
			aliases: ['rmbg'],
		})
	}

	async run({ bot, msg, args, sendUsage }: CmdCtx) {
		if (msg.type !== 'image') return sendUsage()

		const img = await bot.downloadMedia(msg)
		const path = `settings/temp/${Math.random()}.png`
		await writeFile(path, img)

		const { blob, url, path: resPath } = await imgRemover(path, 1)
		print('blob:', blob)
		print('url: ', url)

		bot.send(msg, { image: resPath })
	}
}
