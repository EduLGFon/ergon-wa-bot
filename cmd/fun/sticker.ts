import {
	Cmd,
	CmdCtx,
	delay,
	genStickerMeta,
	isVisualNonSticker,
	makeTempFile,
	Msg,
	runCode,
} from '../../map.js'
import { Sticker } from 'wa-sticker-formatter'
import { readFile } from 'node:fs/promises'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['s', 'sexo'],
			subCmds: ['rmbg', 'crop', 'rounded', 'circle', 'default'],
		})
	}

	async run({ msg, bot, args, user, group, sendUsage, t }: CmdCtx) {
		const isValid = isVisualNonSticker
		// if (!user.warns.find((i) => i === 'MS')) {
		// 	await bot.send(
		// 		msg,
		// 		'[💡] Agora você pode fazer figurinhas de várias imagens enviando ".s" depois delas.',
		// 	)
		// 	user.warns.push('MS')
		// }

		let target = isValid(msg.type) ? msg : (isValid(msg?.quoted?.type) ? msg.quoted : null)
		// target = user msg or user quoted msg

		if (target) {
			await bot.react(msg, 'loading')
			await createSticker(target, this.subCmds)
			await delay(1_000)
			await bot.react(msg, 'ok')
			return /* Why so many 'awaits'?
			* .s is the most used command and sometimes causes rate limit.
			* So, waiting for each task helps to have less problems.
			*/
		}

		// this logic will create a sticker for each media sent by
		// the user until a msg is not from them
		const chat = group || bot.cache.users.find((u) => u.phone === msg.chat.parsePhone())!
		const msgs = chat.msgs.reverse().slice(1)
		// Sorts msgs from newest to oldest and ignores the cmd msg

		// Find the index of the first msg that is not from the same author or is not valid
		const invalidIndex = msgs.findIndex((m) => m.author !== msg.author || !isValid(m.type))

		const validMsgs = invalidIndex === -1 ? msgs : msgs.slice(0, invalidIndex)

		if (validMsgs.length === 0) return sendUsage()
		await bot.react(msg, 'loading')

		for (const m of validMsgs) {
			await createSticker(m, this.subCmds)
			await delay(2000)
		}
		await bot.react(msg, 'ok')

		async function createSticker(target: Msg, subCmds: str[]) {
			// choose between msg media or quoted msg media
			let buffer = await bot.downloadMedia(target)

			if (!Buffer.isBuffer(buffer)) return bot.send(msg, t('sticker.nobuffer'))

			let stickerTypes = ['full', 'crop']
			if (args.includes(subCmds[1])) stickerTypes.push('crop')
			if (args.includes(subCmds[2])) stickerTypes.push('rounded')
			if (args.includes(subCmds[3])) stickerTypes.push('circle')
			if (args.includes(subCmds[4])) stickerTypes.push('default')
			// add other sticker types

			let quality = 20 // media quality after compression

			switch (target.type) {
				case 'video':
					quality = 10 // videos needs to be more compressed
					// but compress a video too much can cause some glitches on video
					break
				case 'image':
					if (args.includes(subCmds[0])) { // remove image background
						const file = await makeTempFile(buffer, 'sticker_', '.webp')
						// create temporary file

						// execute python background remover plugin on
						await runCode('py', `${file} ${file}.png`, 'plugin/removeBg.py')
						// a child process

						buffer = await readFile(`${file}.png`) || buffer
						// read new file
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

			return
		}
	}
}
