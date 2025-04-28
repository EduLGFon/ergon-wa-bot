import { getMedia, now, toBase64 } from 'util/functions.ts'
import { crop } from 'plugin/manipulation.ts'
import { MessageMedia } from 'wa'
import { CmdCtx } from 'types'
import Cmd from 'class/cmd.ts'

export default class extends Cmd {
	constructor() {
		super({
			name: 'sticker',
			alias: ['sexo', 's'],
			cooldown: 4_000,
			// subCmds: [''],
		})
	}

	async run({ bot, msg, user }: CmdCtx) {
		const media = await getMedia(msg)
		if (!media) return msg.reply('Mídia não encontrada')
		const { mime, data, target } = media

		const msgConf = {
			sendMediaAsSticker: true,
			stickerAuthor: '',
			stickerName: `=== Ergon Bot ===\n` +
				`[👑] Autor: ${user.name}\n` +
				`[📅] Data: ${now('D')}\n` +
				// `[☃️] Dev: Edu\n` +
				`[❓] Suporte: dsc.gg/ergon`,
		}

		const rawMedia = new MessageMedia(mime, data)
		await bot.sendMessage(msg.to, rawMedia, msgConf)

		if (target.type === 'image') {
			const buffer = data.toBuffer()
			const cropped = await crop(buffer)

			const croppedMedia = new MessageMedia(
				media.mime,
				toBase64(cropped),
			)
			await bot.sendMessage(msg.to, croppedMedia, msgConf)
		}
		return
	}
}
