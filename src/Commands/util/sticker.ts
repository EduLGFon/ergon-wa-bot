import { clearTemp, getStickerAuthor } from '../../Core/Components/Utils.js';
import type { CmdContext } from '../../Core/Typings/types.js';
import { runCode } from '../../Core/Plugins/RunCode.js';
import { readFileSync, writeFileSync } from 'node:fs';
import Command from '../../Core/Classes/Command.js';
import { Sticker } from 'wa-sticker-formatter';

export default class extends Command {
	constructor() {
		super({
			aliases: ['s', 'sexo', 'makesticker'],
			cooldown: 0,
		});
	}

	async run({ msg, bot, args, user, group, sendUsage, t }: CmdContext) {
		if (!msg.isMedia && !msg.quoted) return sendUsage();

		let stickerTypes = ['rounded', 'full', 'crop', 'circle'];
		let targetMsg = msg.quoted && msg.quoted.isMedia ? msg.quoted : msg;

		let buffer = await bot.downloadMedia(targetMsg);
		if (!buffer) return bot.send(msg, t('sticker.nobuffer'));

		if (args[0] === 'rmbg') {
			const name = Math.random();

			writeFileSync(`temp/${name}.webp`, buffer);
			await runCode({
				file: 'src/Core/Plugins/removeBg.py',
				code: `temp/${name}.webp temp/${name}.png`,
			});
			buffer = readFileSync(`temp/${name}.png`) || buffer;

			clearTemp();
		}

		switch (targetMsg.type) {
			case 'video':
				stickerTypes = ['full', 'rounded'];
				break;
			case 'sticker':
				await bot.send(msg, { image: buffer, gifPlayback: true });
		}

		for (const type of stickerTypes) {
			const metadata = new Sticker(buffer!, {
				...getStickerAuthor(user, group),
				type,
				quality: 60,
			});

			await bot.send(msg.chat, await metadata.toMessage());
		}

		return;
	}
}
