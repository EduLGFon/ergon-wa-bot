import { extractMetadata, Sticker, StickerTypes } from 'wa-sticker-formatter';
import type bot from '../../Core/Bot';
import { link } from '../../config.json';
import Jimp from 'jimp';

export default class implements Command {
	public aliases = ['s', 'makesticker'];
	public access = { dm: true, group: true };
	public cooldown = 0;

	run = async function (this: bot, msg: Msg, args: string[]) {
		let sticker: string | Buffer;
		let mediaTypes = ['imageMessage', 'videoMessage', 'stickerMessage'];

		switch (msg.type) {
			case 'imageMessage':
			case 'videoMessage':
				sticker = await this.downloadMedia(msg);
				break;
			case 'conversation':
			case 'extendedTextMessage':
				if (!args[0] && !msg.quoted) return;

				// se a msg ta respondendo outra msg q contém uma mídia
				if (msg.quoted && mediaTypes.includes(msg.quoted.type!)) {
					sticker = await this.downloadMedia(msg.quoted);

					if (msg.quoted.type === 'stickerMessage') {
						const stkMeta = await extractMetadata(sticker);
						const caption = `*꒷︶꒷꒦ Sticker Info ꒷꒦︶꒷*\n\n` +
							`*Publisher:* ${stkMeta['sticker-pack-publisher'] || ''}\n` +
							`*Pack:* ${stkMeta['sticker-pack-name'] || ''}\n` +
							`*Emojis:* ${stkMeta.emojis || '[]'}\n` +
							`*ID:* ${stkMeta['sticker-pack-id'] || ''}`;

						return await this.send(msg, { caption, image: sticker });
					}
					break;
				}

				const text = args.join(' ')!;
				let font: string;

				if (text.length < 10) font = Jimp.FONT_SANS_64_WHITE;
				else if (text.length > 100) font = Jimp.FONT_SANS_16_WHITE;
				else font = Jimp.FONT_SANS_32_WHITE;

				sticker = await new Promise((res) =>
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
				break;
		}

		const pack = '꒷︶꒷꒦ Sticker ꒷꒦︶꒷\n' +
			'╰───────────╮\n\n' +
			'╭︰꒰👑꒱・Author:\n' +
			'│︰꒰⛄꒱・Group:\n' +
			'│︰꒰🤖꒱・Bot:\n' +
			'│︰꒰❤️꒱・Owner:\n' +
			'╰︰꒰❓꒱・Support:';

		const author = '꒷︶꒷꒦ Metadata ꒷꒦︶꒷\n' +
			'╭────────────╯\n\n' +
			'︰' + msg.username + '\n' +
			'︰' + (msg.group?.subject || 'Not a group') + '\n' +
			'︰Wall-E ⚡\n' +
			'︰Lucas/Sunf3r ⛄\n' +
			`︰${link}`;

		let type = StickerTypes[args[0]?.toUpperCase() as 'FULL'] || StickerTypes.ROUNDED;

		const metadata = new Sticker(sticker!, {
			pack,
			author,
			type,
			categories: ['🎉'],
			id: '12345',
			quality: msg.type === 'videoMessage' ? 1 : 45,
		});

		return await this.send(msg, await metadata.toMessage());
	};
}
