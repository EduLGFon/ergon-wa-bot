import type { CmdContext } from '../../Core/Typings/types.js';
import { cleanTemp } from '../../Core/Components/Utils.js';
import { readFileSync, statSync } from 'node:fs';
import Cmd from '../../Core/Classes/Command.js';
import { execSync } from 'node:child_process';
import { AnyMessageContent } from 'baileys';

type msgMedia = {
	audio?: Buffer;
	video?: Buffer;
	document?: Buffer;
	mimetype: str;
	ptt?: bool;
	fileName: str;
};

export default class extends Cmd {
	constructor() {
		super({
			aliases: ['d'],
			cooldown: 10,
		});
	}

	async run({ bot, msg, args, sendUsage, t }: CmdContext) {
		const mediaOptions = ['video', 'v', 'audio', 'a'];

		if (!args[1] || !mediaOptions.includes(args[0])) return sendUsage();

		const isVideo = args[0] === 'video' || args[0] === 'v';

		let path, msgBody: msgMedia, file: Buffer, ytdlArgs = [];

		if (isVideo) {
			ytdlArgs.push('--remux-video mp4');
			path = `temp/${Math.random()}.mp4`;
			msgBody = { video: file!, mimetype: 'video/mp4', fileName: 'video.mp4' };
		} else {
			ytdlArgs.push('-x', '--audio-format mp3');
			path = `temp/${Math.random()}.mp3`;
			msgBody = {
				audio: file!,
				mimetype: 'audio/mpeg',
				fileName: `audio.mp3`,
				// ptt: true,
			};
		}

		ytdlArgs.push(`-o ${path}`);

		if (!args[1].includes('tiktok.com')) {
			ytdlArgs.push(
				`-u "${process.env.SOCIAL_USERNAME}"`,
				`-p "${process.env.SOCIAL_PASSWORD}"`,
			);
		}

		try {
			await bot.send(msg, t(`download.${isVideo}`));
			execSync(`yt-dlp ${ytdlArgs.join(' ')} ${args[1]}`);

			const file = readFileSync(path);

			attachMedia(msgBody, file, path);
			await bot.send(msg, msgBody as AnyMessageContent);

			cleanTemp();
		} catch (e: any) {
			// remove yt-dlp cli to prevent showing social password
			const error = (e?.stack || e).replace(ytdlArgs.join(' '), 'yt-dlp');

			bot.send(msg, `YT-DLP Error: ${error}`);
		}
		return;
	}
}

function attachMedia(obj: msgMedia, data: Buffer, path: str) {
	const size = statSync(path).size.bytes(true) as number;

	if (obj.video && size < 40) return obj.video = data;

	if (size < 5) return obj.audio = data;

	delete obj.video;
	return obj.document = data;
}
