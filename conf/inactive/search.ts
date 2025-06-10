import { Cmd, CmdCtx, isEmpty } from '../../map.js'
import googleThis from 'googlethis'
import {
	CurrencyResult,
	CurrencyResultNode,
	DictionaryResult,
	DictionaryResultNode,
	OrganicResult,
	OrganicResultNode,
	search,
	TimeResult,
	TimeResultNode,
	TranslateResult,
	TranslateResultNode,
} from 'google-sr'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['se', 'google'],
			cooldown: 5,
		})
	}

	async run({ args, bot, msg, user, sendUsage, t }: CmdCtx) {
		if (!args[0]) return sendUsage()

		const query = await search({
			query: args.join(' ').trim(),
			resultTypes: [
				TimeResult,
				OrganicResult,
				CurrencyResult,
				TranslateResult,
				DictionaryResult,
			],
			requestConfig: {
				params: {
					hl: user.lang, // search content on user's language
					lr: `lang_${user.lang}`.toLowerCase(),
					cr: 'countryBR',
				},
			},
		})

		if (!query) return bot.send(msg, t('search:notFound'))

		let text = '' // it's what the bot will say
		let pronunciation = ''
		query.length = 3 // limit to 3 results

		const info = await googleThis.search(args.join(' ').trim()!, {
			parse_ads: false, // searches for more info
			safe: false,
			additional_params: { hl: user.lang },
		})
		/** BIG DISCLAIMER
		 * i know this code is terrible. I'll fix it later
		 * I just don't have any time rn and need it to work properly
		 * I'll make object literals later
		 */
		// print(info)
		const {
			did_you_mean: dym,
			unit_converter: unit,
			people_also_ask: ask,
			knowledge_panel: panel,
			weather: w,
			featured_snippet: snippet,
		} = info

		if (dym) text += `> ${dym}*\n`

		if (!isEmpty(panel)) {
			text += `${panel.title || ''}\n> ${panel.description}\n`

			for (const m of panel.metadata) {
				text += `*${m.title}:* ${m.value}\n`
			}

			for (const r of panel.ratings) {
				text += `*${r.name}*: ${r.rating}`
			}
		}

		if (!isEmpty(snippet)) {
			text += `*${snippet.title}*\n> ${
				snippet.description?.replace('\n', '\n> ')
			}\n- ${snippet.url}\n`
		}

		if (!isEmpty(w)) {
			text +=
				`*${location} - ${w.temperature}*\n⏰: ${w.forecast}\n🌧️: ${w.precipitation}\n💦: ${w.humidity}\n🌬️: ${w.wind}`
		}

		if (!isEmpty(unit)) {
			text +=
				`${unit.input.name} (${unit.input.value}) => ${unit.output.name} (${unit.output.value})\n`
		}

		if (ask[0]) text += `\n*People also ask:*\n- ` + ask.join('\n- ')

		const responseFunctions = {
			async ORGANIC(r: OrganicResultNode) {
				const { title, link, description } = r // websites

				text += `*${title}:*\n> ${description} (${link})`
			},
			async DICTIONARY(r: DictionaryResultNode) {
				const { word, phonetic, audio, definitions } = r // dictionary result

				if (audio) pronunciation = audio // word pronunciation

				const moreInfo = await googleThis.search(word!, {
					parse_ads: false, // searches for more info
					safe: false,
					additional_params: { hl: user.lang },
				})

				const { title, type, description, metadata } = moreInfo?.knowledge_panel

				text += `*${title || word}* (${type || phonetic})`
				// e.g.: *Donald Trump* (45th U.S. President)

				if (description) text += `\n> ${description}\n`
				// > Donald John Trump is bla bla bla

				for (const { title: key, value } of metadata) {
					text += `\n*> ${key}*: ${value}`
				}
			},
			CURRENCY(r: CurrencyResultNode) {
				const { from, to, type } = r

				text += `*${from} => ${to} (${type})*`

				query.length = 1 // only one result is enough
			},
			TIME(r: TimeResultNode) {
				const { location, time, timeInWords } = r

				text += `*${time}* - ${timeInWords!.split('\n')[0]} (${location})`

				query.length = 1
			},
			TRANSLATE(r: TranslateResultNode) {
				text += `${r.sourceLanguage}  ➟  ${r.translationLanguage}\n`
				text += `*${r.translationText}* `

				if (r.translationPronunciation) text += `(${r.translationPronunciation})`
				// word pronunciation if available

				query.length = 1
			},
		}

		for (const result of query) {
			text += '\n\n'

			await responseFunctions[result.type as 'TIME'](result as any)
		}

		await bot.send(msg, text.trim())

		if (pronunciation) { // then send word pronunciation
			bot.send(msg, {
				audio: { url: pronunciation },
				mimetype: 'audio/mpeg',
				fileName: 'pronunciation.mp3',
				ptt: true,
			})
		}
		return
	}
}
