import { cleanTemp, genStickerMeta } from '../../Core/Components/Utils.js';
import type { CmdContext } from '../../Core/Typings/types.js';
import { runCode } from '../../Core/Plugins/RunCode.js';
import { readFileSync, writeFileSync } from 'node:fs';
import Cmd from '../../Core/Classes/Command.js';
import { Sticker } from 'wa-sticker-formatter';

export default class extends Cmd {
	constructor() {
		super({
			aliases: ['s', 'sexo', 'makesticker'],
			cooldown: 0,
		});
	}

	async run({ msg, bot, args, user, group, sendUsage, t }: CmdContext) {
		if (!msg.isMedia && !msg.quoted) return sendUsage();

		let targetMsg = msg.isMedia ? msg : msg.quoted;
		let buffer = await bot.downloadMedia(targetMsg);

		if (!buffer) return bot.send(msg, t('sticker.nobuffer'));

		await bot.react(msg, '⌛');
		let stickerTypes = ['rounded', 'full', 'crop', 'circle'];
		let quality = 15;

		switch (targetMsg.type) {
			case 'video':
				stickerTypes = ['full', 'rounded'];
				quality = 1;
				break;
			case 'sticker':
				await bot.send(msg, { image: buffer, gifPlayback: true });
			case 'image':
				if (args[0] === 'rmbg') {
					const name = Math.random();

					writeFileSync(`temp/${name}.webp`, buffer);
					await runCode({
						file: 'src/Core/Plugins/removeBg.py',
						code: `temp/${name}.webp temp/${name}.png`,
					});
					buffer = readFileSync(`temp/${name}.png`) || buffer;

					cleanTemp();
				}
		}

		for (const type of stickerTypes) {
			const metadata = new Sticker(buffer!, {
				...genStickerMeta(user, group),
				type,
				quality,
			});

			await bot.send(msg.chat, await metadata.toMessage());
		}

		bot.react(msg, '✅');
		return;
	}
}
