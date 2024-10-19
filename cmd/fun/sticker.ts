import { cleanTemp, Cmd, CmdCtx, genStickerMeta, isVisual, runCode } from '../../map.js'
import { readFileSync, writeFileSync } from 'node:fs'
import { Sticker } from 'wa-sticker-formatter'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['s', 'sexo', 'makesticker'],
			cooldown: 0,
		})
	}

	async run({ msg, bot, args, user, group, sendUsage, t }: CmdCtx) {
		if (!isVisual(msg.type) && !isVisual(msg.quoted?.type)) return sendUsage()

		let target = isVisual(msg.type) ? msg : msg.quoted
		// choose between msg media or quoted msg media
		let buffer = await bot.downloadMedia(target)

		if (!buffer) return bot.send(msg, t('sticker.nobuffer'))
		await bot.react(msg, 'loading')

		let stickerTypes = ['rounded', 'full', 'crop', 'circle']
		let quality = 20 // media quality after compression

		switch (target.type) {
			case 'video':
				stickerTypes = ['full', 'rounded'] // crop videos requires a stronger machine
				quality = 10 // videos needs to be more compressed
				// but compress a video too much can cause some glitches on video
				break
			case 'sticker':
				await bot.send(msg, { image: buffer, gifPlayback: true })
				// sends sticker image
			case 'image':
				if (args[0] === 'rmbg') { // remove image background
					const name = Math.random()
					writeFileSync(`temp/${name}.webp`, buffer) // create temp file

					await runCode({ // execute python background remover plugin on
						file: 'plugin/removeBg.py', // a separate thread
						code: `settings/temp/${name}.webp settings/temp/${name}.png`, // cli args
					})
					buffer = readFileSync(`settings/temp/${name}.png`) || buffer // read returned file

					cleanTemp() // clean temp folder
				}
		}

		for (const type of stickerTypes) {
			const metadata = new Sticker(buffer!, { // create sticker metadata
				...genStickerMeta(user, group), // sticker author and pack
				type,
				quality,
			})
			// send several crop types of the same sticker
			await bot.send(msg.chat, await metadata.toMessage())
		}

		bot.react(msg, 'ok')
		return
	}
}
