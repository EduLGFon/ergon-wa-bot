import { extractMetadata, Sticker } from 'wa-sticker-formatter';
import { author, link, pack } from '../../config.json';
import { CmdContext, Msg } from '../../Typings';
import Command from '../../Core/Command';
import Jimp from 'jimp';
import Bot from '../../Core/Bot';

export default class extends Command {
	constructor() {
		super({
			aliases: ['s', 'makesticker'],
			cooldown: 0,
		});
	}

	async run({ msg, bot, args, group }: CmdContext) {
		let sticker: string | Buffer;
		let textSticker = false;
		let mediaTypes = ['imageMessage', 'videoMessage', 'stickerMessage'];

		switch (msg.type) {
			case 'imageMessage':
			case 'videoMessage':
				sticker = await bot.downloadMedia(msg);
				break;
			case 'conversation':
			case 'extendedTextMessage':
				if (!args[0] && !msg.quoted) return;

				// if the quoted msg has media
				if (msg.quoted && mediaTypes.includes(msg.quoted.type!)) {
					sticker = await bot.downloadMedia(msg.quoted);

					if (msg.quoted.type === 'stickerMessage') {
						await this.sendMetadata(bot, msg, sticker);
					}
					break;
				}

				textSticker = true;
				sticker = await this.createSticker(args);
				break;
		}

		const types = ['rounded', 'full', 'crop', 'circle'];
		const fixedAuthor = author.join('')
			.replace('{username}', msg.author)
			.replace('{link}', link)
			.replace('{group}', group?.subject || 'Not a group');

		for (let type of types) {
			const metadata = new Sticker(sticker!, {
				pack: pack.join(''),
				author: fixedAuthor,
				type,
				categories: ['🎉'],
				id: '12345',
				quality: 1,
			});

			await bot.send(msg.chat, await metadata.toMessage());
			if (textSticker) return;
		}
	}

	createSticker = async (args: string[]): Promise<string | Buffer> => {
		return await new Promise(async (res) => {
			new Jimp(256, 256, async (_e: string, img: Jimp) => {
				const font = await Jimp.loadFont(
					'src/Fonts/gabriele/CBcrZpI4cOEGer9G62GrK_JZ.ttf.fnt',
				);
				img.print(
					font,
					10,
					10,
					{
						text: args.join(' '),
						alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
						alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE,
					},
					240,
					240,
				);

				res(await img.getBufferAsync(Jimp.MIME_PNG));
			});
		});
	};

	sendMetadata = async (bot: Bot, msg: Msg, sticker: Buffer) => {
		const stkMeta = await extractMetadata(sticker);
		const caption = `*꒷︶꒷꒦ Sticker Info ꒷꒦︶꒷*\n\n` +
			`*Publisher:* ${stkMeta['sticker-pack-publisher'] || ''}\n` +
			`*Pack:* ${stkMeta['sticker-pack-name'] || ''}\n` +
			`*Emojis:* ${stkMeta.emojis || '[]'}\n` +
			`*ID:* ${stkMeta['sticker-pack-id'] || ''}`;

		await bot.send(msg, { caption, image: sticker });
	};
}
