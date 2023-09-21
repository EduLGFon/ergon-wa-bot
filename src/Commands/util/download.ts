import Command from '../../Components/Classes/Command';
import { CmdContext } from '../../Components/Typings';
import { execSync } from 'child_process';
import { readFileSync, unlinkSync } from 'fs';

export default class extends Command {
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

		let path, mediaData, ytdlArgs = [];

		if (isVideo) {
			ytdlArgs.push('--remux-video mp4');
			path = `temp/${Math.random()}.mp4`;
			mediaData = { mimetype: 'video/mp4', fileName: 'video.mp4' };
		} else {
			ytdlArgs.push('-x', '--audio-format mp3');
			path = `temp/${Math.random()}.mp3`;
			mediaData = { mimetype: 'audio/mpeg', fileName: 'audio.mp3' };
		}

		ytdlArgs.push(`-o ${path}`);

		try {
			await bot.send(msg, t(`download.${isVideo}`));
			execSync(`ytdl ${ytdlArgs.join(' ')} ${args[1]}`);

			const file = readFileSync(path);
			await bot.send(msg, { document: file, ...mediaData });

			unlinkSync(path);
		} catch (e: any) {
			await bot.send(msg, `error: ${e?.stack || e}`);
		}

		return true;
	}
}
