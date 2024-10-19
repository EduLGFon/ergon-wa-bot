import { readFileSync, writeFileSync } from 'node:fs'
import { Sticker } from 'wa-sticker-formatter'
import { Cmd, CmdCtx, cleanTemp, genStickerMeta, runCode } from '../../map.js'

export default class extends Cmd {
	constructor() {
		super({
			aliases: ['s', 'sexo', 'makesticker'],
			cooldown: 0,
		})
	}

	async run({ msg, bot, args, user, group, sendUsage, t }: CmdCtx) {
		if (!msg.isMedia && !msg.quoted) return sendUsage()

		let targetMsg = msg.isMedia ? msg : msg.quoted
		let buffer = await bot.downloadMedia(targetMsg)

		if (!buffer) return bot.send(msg, t('sticker.nobuffer'))

		await bot.react(msg, '⌛')
		let stickerTypes = ['rounded', 'full', 'crop', 'circle']
		let quality = 15

		switch (targetMsg.type) {
			case 'video':
				stickerTypes = ['full', 'rounded']
				quality = 1
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

		bot.react(msg, '✅')
		return
	}
}
