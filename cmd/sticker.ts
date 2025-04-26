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

	async run({ bot, msg }: CmdCtx) {
		const target = msg.hasMedia ? msg : (msg.hasQuotedMsg ? await msg.getQuotedMessage() : msg)
		if (!target.hasMedia) return msg.reply('Mídia não encontrada')

		const media = await target.downloadMedia()
		if (!media) return bot.sendMessage(msg.to, 'Falha ao baixar mídia.')

		const rawMedia = new MessageMedia(media.mimetype, media.data)
		await bot.sendMessage(msg.to, rawMedia, { sendMediaAsSticker: true })
		return
	}
}
