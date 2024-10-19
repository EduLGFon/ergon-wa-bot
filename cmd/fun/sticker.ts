import { cleanTemp, Cmd, CmdCtx, genStickerMeta, isVisual, runCode } from '../../map.js'
import { readFileSync, writeFileSync } from 'node:fs'
import { Sticker } from 'wa-sticker-formatter'

export default class extends Cmd {
	constructor() {
		super({
			aliases: ['s', 'sexo', 'makesticker'],
			cooldown: 0,
		})
	}

	async run({ msg, bot, args, user, group, sendUsage, t }: CmdCtx) {
		if (!isVisual(msg.type) && !isVisual(msg.quoted?.type)) return sendUsage()

		let target = isVisual(msg.type) ? msg : msg.quoted
		let buffer = await bot.downloadMedia(target)

		if (!buffer) return bot.send(msg, t('sticker.nobuffer'))

		await bot.react(msg, 'loading')
		let stickerTypes = ['rounded', 'full', 'crop', 'circle']
		let quality = 20

		switch (target.type) {
			case 'video':
				stickerTypes = ['full', 'rounded']
				quality = 5
				break
			case 'sticker':
				await bot.send(msg, { image: buffer, gifPlayback: true })
			case 'image':
				if (args[0] === 'rmbg') {
					const name = Math.random()

					writeFileSync(`temp/${name}.webp`, buffer)

					await runCode({
						file: 'plugin/removeBg.py',
						code: `settings/temp/${name}.webp settings/temp/${name}.png`,
					})
					buffer = readFileSync(`settings/temp/${name}.png`) || buffer

					cleanTemp()
				}
		}

		for (const type of stickerTypes) {
			const metadata = new Sticker(buffer!, {
				...genStickerMeta(user, group),
				type,
				quality,
			})

			await bot.send(msg.chat, await metadata.toMessage())
		}

		bot.react(msg, 'ok')
		return
	}
}
