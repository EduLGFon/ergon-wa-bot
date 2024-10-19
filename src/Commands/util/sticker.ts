import { extractMetadata, Sticker } from 'wa-sticker-formatter';
import { readFileSync, unlink, writeFileSync } from 'fs';
import { getStickerAuthor } from '../../Core/Utils';
import { CmdContext, Msg } from '../../Typings';
import Command from '../../Core/Command';
import { execSync } from 'child_process';

export default class extends Command {
	constructor() {
		super({
			aliases: ['s', 'makesticker'],
			cooldown: 0,
		});
	}

	async run({ msg, bot, args, group }: CmdContext) {
		let stickerTypes = ['rounded', 'full', 'crop', 'circle'];
		let targetMsg: Msg;

		if (msg.quoted && msg.quoted.isMedia) targetMsg = msg.quoted;
		else targetMsg = msg;

		let buffer = await bot.downloadMedia(targetMsg)
			.catch(() => {});
		if (!buffer) return;

		if (args[0] === 'nobg') {
			const name = Math.random();

			writeFileSync(`temp/${name}.webp`, buffer);
			execSync(`python3 src/Core/removeBg.py temp/${name}.webp temp/${name}.png`);
			buffer = readFileSync(`temp/${name}.png`) || buffer;
			unlink(`temp/${name}.png`, () => {});
			unlink(`temp/${name}.webp`, () => {});
		}

		switch (targetMsg.type) {
			case 'video':
				stickerTypes = ['full', 'rounded'];
				break;
			case 'sticker':
				await bot.send(msg, await this.sendMetadata(buffer));
		}

		for (const type of stickerTypes) {
			const metadata = new Sticker(buffer!, {
				...getStickerAuthor(msg, group),
				type,
				quality: 60,
			});

			await bot.send(msg.chat, await metadata.toMessage());
		}
		return;
	}

	sendMetadata = async (sticker: Buffer) => {
		const {
			'sticker-pack-publisher': publisher = '',
			'sticker-pack-name': packName = '',
			emojis = '[]',
			'sticker-pack-id': packId = '',
		} = await extractMetadata(sticker);

		const caption = `*꒷︶꒷꒦ Sticker Info ꒷꒦︶꒷*\n\n` +
			`*Publisher:* ${publisher}\n` +
			`*Pack:* ${packName}\n` +
			`*Emojis:* ${emojis}\n` +
			`*ID:* ${packId}`;

		return { caption, image: sticker };
	};
}
