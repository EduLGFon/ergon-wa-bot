import { CmdContext } from '../../Core/Typings/types.js';
import Command from '../../Core/Classes/Command.js';
import * as g from 'google-sr';
import googleThis from 'googlethis';

export default class extends Command {
	constructor() {
		super({
			aliases: ['search', 'g'],
		});
	}

	async run({ args, bot, msg, user, sendUsage, t }: CmdContext) {
		if (!args[0]) return sendUsage();

		let text = ''; // it's what the bot will say
		const query = await g.search({
			query: args.join(' ').trim(),
			safeMode: false,
			filterResults: [
				g.ResultTypes.DictionaryResult,
				g.ResultTypes.TranslateResult,
				g.ResultTypes.CurrencyResult,
				g.ResultTypes.SearchResult,
				g.ResultTypes.TimeResult,
			],
			requestConfig: {
				params: {
					hl: user.lang,
					lr: `lang_${user.lang}`.toLowerCase(),
				},
			},
		});

		if (!query) return bot.send(msg, t('search:notFound'));

		const responseFunctions = {
			SEARCH(r: g.SearchResultNode) {
				const { title, link, description } = r;

				text += `*${title}:*\n> ${description} (${link})`;
			},
			async DICTIONARY(r: g.DictionaryResultNode) {
				const moreInfo = await googleThis.search(r.word, {
					parse_ads: false,
					safe: false,
					additional_params: { hl: user.lang },
				});

				const panel = moreInfo?.knowledge_panel;

				text += `*${panel?.title}* (${panel?.type})\n> ` + (panel?.description || '');
				// e.g.: *Donald Trump* (45th U.S. President)
				// > Donald John Trump is bla bla bla

				for (const { title, value } of panel?.metadata) text += `\n*${title}*: ${value}`;
			},
			CURRENCY(r: g.CurrencyResultNode) {
				const { formula } = r;

				text += `*${formula}*`;

				query.length = 1;
			},
			TIME(r: g.TimeResultNode) {
				const { timeInWords } = r;

				text += `*${timeInWords}*`;

				query.length = 1;
			},
			TRANSLATE(r: g.TranslateResultNode) {
				const { source: src, translation: res } = r;

				text += `${src.language}  ➟  ${res.language}\n`;
				text += `*${res.text}* (${res.pronunciation})`;

				query.length = 1;
			},
		};

		query.length = 3; // limit to 3 results

		for (const result of query) {
			text += '\n\n';

			await responseFunctions[result.type as 'SEARCH'](result as any);
		}

		bot.send(msg, text.trim());
		return;
	}
}
