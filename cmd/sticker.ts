import Cmd from 'class/cmd.ts'
import { CmdCtx } from 'types'
import { MessageMedia } from 'wa'
import { randomEmoji } from 'util/emojis.ts'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['sexo', 's'],
			cooldown: 4,
			subCmds: [''],
		})
	}

	async run({ bot, msg, args }: CmdCtx) {
		if (!msg.hasMedia) return msg.reply('Please send a image.')

		const media = await msg.downloadMedia()
		if (!media) return msg.reply('Failed to download media.')
		await msg.react(randomEmoji())
		const newMedia = new MessageMedia(media.mimetype, media.data)
		await bot.sendMessage(msg.to, newMedia, {
			sendMediaAsSticker: true,
		})
		return
	}
}
