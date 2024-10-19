import { extractMetadata, Sticker } from 'wa-sticker-formatter';
import { author, link, pack } from '../../config.json';
import { CmdContext } from '../../Typings';
import Command from '../../Core/Command';
import Jimp from 'jimp';

export default class extends Command {
	constructor() {
		super({
			aliases: ['s', 'makesticker'],
			cooldown: 0,
		});
	}

	async run(ctx: CmdContext) {
		let sticker: string | Buffer;
		let textSticker = false;
		let mediaTypes = ['imageMessage', 'videoMessage', 'stickerMessage'];

		switch (ctx.msg.type) {
			case 'imageMessage':
			case 'videoMessage':
				sticker = await ctx.bot.downloadMedia(ctx.msg);
				break;
			case 'conversation':
			case 'extendedTextMessage':
				if (!ctx.args[0] && !ctx.msg.quoted) return;

				// se a msg ta respondendo outra ctx.msg q contém uma mídia
				if (ctx.msg.quoted && mediaTypes.includes(ctx.msg.quoted.type!)) {
					sticker = await ctx.bot.downloadMedia(ctx.msg.quoted);

					if (ctx.msg.quoted.type === 'stickerMessage') {
						await this.sendMetadata(ctx, sticker);
					}
					break;
				}

				textSticker = true;
				sticker = await this.createSticker(ctx.args);
				break;
		}

		const types = ['rounded', 'full', 'crop', 'circle'];
		const fixedAuthor = author.join('')
			.replace('{username}', ctx.msg.username)
			.replace('{link}', link)
			.replace('{group}', ctx.msg.group?.subject || 'Not a group');

		for (let type of types) {
			const metadata = new Sticker(sticker!, {
				pack: pack.join(''),
				author: fixedAuthor,
				type,
				categories: ['🎉'],
				id: '12345',
				quality: 1,
			});

			await ctx.bot.send(ctx.msg, await metadata.toMessage());
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

	sendMetadata = async (ctx: CmdContext, sticker: Buffer) => {
		const stkMeta = await extractMetadata(sticker);
		const caption = `*꒷︶꒷꒦ Sticker Info ꒷꒦︶꒷*\n\n` +
			`*Publisher:* ${stkMeta['sticker-pack-publisher'] || ''}\n` +
			`*Pack:* ${stkMeta['sticker-pack-name'] || ''}\n` +
			`*Emojis:* ${stkMeta.emojis || '[]'}\n` +
			`*ID:* ${stkMeta['sticker-pack-id'] || ''}`;

		await ctx.bot.send(ctx.msg, { caption, image: sticker });
	};
}
