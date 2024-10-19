import { CmdContext } from '../../Core/Typings/types.js';
import { isEmpty } from '../../Core/Components/Utils.js';
import Command from '../../Core/Classes/Command.js';
import google from 'googlethis';

export default class extends Command {
	constructor() {
		super({
			aliases: ['search', 'g'],
		});
	}

	async run({ args, bot, msg, user, sendUsage, t }: CmdContext) {
		if (!args[0]) return sendUsage();

		let img = '';
		let source = '\n'; // data & img links
		let text = ''; // it's what the bot will say
		const query = await google.search(args.join(' ').trim(), {
			page: 0,
			safe: false, // Safe Search
			parse_ads: false, // If set to true sponsored results will be parsed
			additional_params: {
				/* add additional parameters here,
                see https://moz.com/blog/the-ultimate-guide-to-the-google-search-parameters
                and https://www.seoquake.com/blog/google-search-param/
                */
				hl: user.lang,
			},
		});

		if (!query) return bot.send(msg, t('search:notFound'));

		const responseFunctions = {
			knowledge_panel() {
				const { title, type, description, url, metadata, images } = query.knowledge_panel;
				source += `URL: ${url}`;

				text += `*${title}* (${type}) \n\n` + '> ' + (description || '');
				// e.g.: *Donald Trump* (45th U.S. President)
				// > Donald John Trump is bla bla bla

				for (const { title, value } of metadata) text += `\n*${title}*: ${value}\n`;
				// e.g.: Age: 69

				if (images[0]) {
					img = images[0].url;

					source += '\nImage source: ' + images[0].source || 'not found';
				}
			},
			videos() {
				for (let i = 0; i < 3; i++) {
					const { title, author, duration, url } = query.videos[i];

					text += `video: (${title} - ${author})[${url}] [${duration}]`;
				}
			},
			results() {
				for (let i = 0; i < 3; i++) {
					const { title, description, is_sponsored, url } = query.results[i];

					if (is_sponsored) return;

					text += `\n[${title}](${url}): \n ${description || ''}\n`;
					// Title hyperlink: description
				}
			},
		};

		for (const [key, value] of Object.entries(query)) {
			const objLiteral = responseFunctions[key as 'videos'];

			if (!isEmpty(value) && objLiteral) objLiteral();
		}

		text += source;

		return bot.send(msg, { text, image: { url: img } });
	}
}
