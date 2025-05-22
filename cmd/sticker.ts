import { now, randomDelay, toBase64 } from 'util/functions.ts'
// import { crop } from 'plugin/manipulation.ts'
import { getMedia } from 'util/message.ts'
import { Buffer } from 'node:buffer'
import { run } from 'util/proto.ts'
import { MessageMedia } from 'wa'
import { CmdCtx } from 'types'
import Cmd from 'class/cmd.ts'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['sexo', 's'],
			cooldown: 5_000,
			// subCmds: [''],
		})
	}

	async run({ msg, user, send, startTyping }: CmdCtx) {
		const media = await getMedia(msg, startTyping) // download msg media or quoted msg media
		await randomDelay()
		if (!media) return msg.reply('Mídia não encontrada')
		const { mime, data, target } = media

		const msgConf = { // default sticker settings
			sendMediaAsSticker: true,
			stickerAuthor: '',
			stickerName: `=== Ergon Bot ===\n` +
				`[👑] Autor: ${user.name}\n` +
				`[📅] Data: ${now('D')}\n` +
				// `[☃️] Dev: Edu\n` +
				`[❓] Suporte: dsc.gg/ergon`,
		}
		const rawMedia = new MessageMedia(mime, data)

		const msgtypeWays = {
			image() {
				// const buffer = Buffer.from(data, 'base64')
				// const cropped = await crop(buffer)

				// const croppedMedia = new MessageMedia(
				// 	media.mime,
				// 	toBase64(cropped),
				// )
				// await send(croppedMedia, msgConf)
				return
			},
			async video() {
				const name = Date.now() + '.mp4'
				const buffer = Buffer.from(data, 'base64')
				const input = `conf/temp/${name}`
				const output = `conf/temp/crop_${name}.gif`
				await Deno.writeFile(input, buffer)

				await run([
					'ffmpeg',
					'-i',
					input,
					'-vf',
					// "crop='in_w:in_w'",
					"crop='min(in_w\,in_h)':'min(in_w\,in_h)'",
					'-y',
					output,
				])

				const cropped = await Deno.readFile(output)
				const croppedMedia = new MessageMedia('video/gif', toBase64(cropped))
				await send(croppedMedia, msgConf)
				Deno.remove(input)
				Deno.remove(output)
				return
			},
			sticker() {
				send(rawMedia)
				return
			},
		}

		if (target.type in msgtypeWays) {
			await send(rawMedia, msgConf)
			// @ts-ignore don't fuck
			msgtypeWays[target.type]()
		}
		return
	}
}
