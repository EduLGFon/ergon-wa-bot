import { crop } from 'plugin/manipulation.ts'
import { now } from 'util/functions.ts'
import { Buffer } from 'node:buffer'
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
		const target = msg.hasMedia ? msg : (msg.hasQuotedMsg ? await msg.getQuotedMessage() : msg)
		if (!target.hasMedia) return msg.reply('Mídia não encontrada')

		const media = await target.downloadMedia()
		if (!media) return bot.sendMessage(msg.to, 'Falha ao baixar mídia.')
		const msgConf = {
			sendMediaAsSticker: true,
			stickerAuthor: '',
			stickerName: `=== Ergon Bot ===\n` +
				`[👑] Autor: ${user.name}\n` +
				`[📅] Data: ${now('D')}\n` +
				// `[☃️] Dev: Edu\n` +
				`[❓] Suporte: dsc.gg/ergon`,
		}

		const rawMedia = new MessageMedia(media.mimetype, media.data)
		await bot.sendMessage(msg.to, rawMedia, msgConf)

		if (target.type === 'image') {
			const buffer = Buffer.from(media.data, 'base64')
			const cropped = await crop(buffer)

			const croppedMedia = new MessageMedia(
				media.mimetype,
				Buffer.from(cropped).toString('base64'),
			)
			await bot.sendMessage(msg.to, croppedMedia, msgConf)
		}
		return
	}
}
