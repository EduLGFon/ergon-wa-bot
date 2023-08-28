import { extractMetadata, Sticker, StickerTypes } from 'wa-sticker-formatter';
import { CmdContext } from '../../Typings';
import { link } from '../../config.json';
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
						const stkMeta = await extractMetadata(sticker);
						const caption = `*꒷︶꒷꒦ Sticker Info ꒷꒦︶꒷*\n\n` +
							`*Publisher:* ${stkMeta['sticker-pack-publisher'] || ''}\n` +
							`*Pack:* ${stkMeta['sticker-pack-name'] || ''}\n` +
							`*Emojis:* ${stkMeta.emojis || '[]'}\n` +
							`*ID:* ${stkMeta['sticker-pack-id'] || ''}`;

						return await ctx.bot.send(ctx.msg, { caption, image: sticker });
					}
					break;
				}

				sticker = await this.createSticker(ctx.args);
				break;
		}

		const pack = '꒷︶꒷꒦ Sticker ꒷꒦︶꒷\n' +
			'╰───────────╮\n\n' +
			'╭︰꒰👑꒱・Author:\n' +
			'│︰꒰🤖꒱・Bot:\n' +
			'│︰꒰❤️꒱・Owner:\n' +
			'│︰꒰❓꒱・Support:\n' +
			'╰︰꒰⛄꒱・Group:';

		const author = '꒷︶꒷꒦ Metadata ꒷꒦︶꒷\n' +
			'╭────────────╯\n\n' +
			'︰' + ctx.msg.username + '\n' +
			'︰Wall-E ⚡\n' +
			'︰Lucas/Sunf3r ⛄\n' +
			`︰${link}\n` +
			'︰' + (ctx.msg.group?.subject || 'Not a group');

		let type = StickerTypes[ctx.args[0]?.toUpperCase() as 'FULL'] || StickerTypes.ROUNDED;

		const metadata = new Sticker(sticker!, {
			pack,
			author,
			type,
			categories: ['🎉'],
			id: '12345',
			quality: 1,
		});

		return await ctx.bot.send(ctx.msg, await metadata.toMessage());
	}

	createSticker = async (args: string[]): Promise<string | Buffer> => {
		const text = args.join(' ')!;
		let font: string;

		if (text.length < 10) font = Jimp.FONT_SANS_64_WHITE;
		else if (text.length > 100) font = Jimp.FONT_SANS_16_WHITE;
		else font = Jimp.FONT_SANS_32_WHITE;

		return await new Promise((res) =>
			new Jimp(256, 256, (_e: string, img: Jimp) => {
				Jimp.loadFont(font).then(async (font: any) => {
					img.print(
						font,
						10,
						10,
						{
							text,
							alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
							alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE,
						},
						240,
						240,
					);
					res(await img.getBufferAsync(Jimp.MIME_PNG));
				});
			})
		);
	};
}
