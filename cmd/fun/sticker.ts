import { Cmd, CmdCtx, defaults, isVisual, Msg, runCode } from '../../map.js'
import { readFile, writeFile } from 'node:fs/promises'
import { randomDelay } from '../../util/functions.js'
import { getMedia } from '../../util/messages.js'
import { Sticker } from 'wa-sticker-formatter'
import { now } from '../../util/proto.js'
import cache from '../../plugin/cache.js'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['s', 'sexo'],
			cooldown: 5_000,
			subCmds: ['rmbg', 'rounded', 'circle', 'default'],
		})
	}

	async run({ msg, args, user, group, send, react, startTyping, t }: CmdCtx) {
		const media = await getMedia(msg)

		// if there is no media or msg type is not visual
		if (!media || !isVisual(media.target.type)) {
			// this logic will create a sticker for each media sent by
			// the user until a msg is not from them
			const chat = group || cache.users.find((u) => u.phone === msg.chat.parsePhone())!
			const msgs = chat.msgs.reverse().slice(1)
			// Sorts msgs from newest to oldest and ignores the cmd msg

			// Find the index of the first msg that is not from the same author or is not valid
			const invalidIndex = msgs.findIndex((m) =>
				m.author !== msg.author || !isVisual(m.type) || m.type === 'sticker'
			)

			const validMsgs = invalidIndex === -1 ? msgs : msgs.slice(0, invalidIndex)

			if (!validMsgs.length) return send('usage.sticker', user)
			await randomDelay(69, 500)
			await react('random')

			for (const m of validMsgs) await createSticker(m, this.subCmds)
			return
		}

		await randomDelay(69, 500)
		await react('random')
		createSticker(media.target, this.subCmds)
		return

		async function createSticker(target: Msg, subCmds: str[]) {
			const media = await getMedia(target)
			let { data, mime } = media!
			let quality = 20 // media quality after compression

			const formats = ['full', 'crop']
			if (args.includes(subCmds[1])) formats.push('rounded')
			if (args.includes(subCmds[2])) formats.push('circle')
			if (args.includes(subCmds[3])) formats.push('default')
			// add other sticker formats

			const msgTypeWays = {
				sticker() {
					send({ image: data })
					return
				},
				async image() {
					if (!args.includes(subCmds[0])) return
					// remove image background
					const file = await writeFile(
						defaults.runner.tempFolder + `sticker_${Date.now()}.webp`,
						data,
					)
					// create temporary file

					// execute python background remover plugin on
					await runCode('py', `${file} ${file}.png`, 'plugin/removeBg.py')
					// a child process

					data = await readFile(`${file}.png`) || data
					// read new file
					return
				},
				async video() {
					// quality = Number(args[0]) || 25 // videos needs to be more compressed
					// but compress a video too much can cause some glitches on video
				},
			}

			if (target.type in msgTypeWays) {
				await msgTypeWays[target.type as keyof typeof msgTypeWays]()
			}

			for (const type of formats) {
				const sticker = await new Sticker(data!, {
					author: '', // sticker metadata
					pack: `=== Ergon Bot ===\n` +
						`[👑] Autor: ${user.name}\n` +
						`[📅] Data: ${now('D')}\n` +
						// `[☃️] Dev: Edu\n` +
						`[❓] Suporte: dsc.gg/ergon`,
					type,
					quality: 1,
				}).toMessage()

				if (target.type === 'video') send(sticker)
				else {
					await randomDelay()
					send(sticker)
				}
			}

			return
		}
	}
}
