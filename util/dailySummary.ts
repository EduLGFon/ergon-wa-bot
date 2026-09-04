import { type ClassifiedCalendar } from '@util/calendarAnalytics.ts'
import defaults from '@conf/defaults.json' with { type: 'json' }
import { getNextBulletinTitle } from '@util/bulletinTitles.ts'
import { type ParsedMenuResult } from '@util/menuParser.ts'
import { type WeatherReport } from '@util/weather.ts'
import { GoogleGenAI } from '@google/genai'

export interface DailySummaryInput {
	dateStr: string
	weather: WeatherReport | null
	menu: ParsedMenuResult | null
	calendar: ClassifiedCalendar | null
	bulletinTitle?: string
	campusName?: string
}

export async function generateDailySummary(
	input: DailySummaryInput,
): Promise<string> {
	if (!input.bulletinTitle) {
		input.bulletinTitle = await getNextBulletinTitle()
	}

	const apiKey = Deno.env.get('GEMINI')
	if (!apiKey) {
		if (typeof print === 'function') {
			print(
				'DAILYSUMMARY',
				'No GEMINI API key found. Using deterministic fallback.',
				'yellow',
			)
		}
		return generateFallbackSummary(input)
	}

	try {
		const GoogleAI = new GoogleGenAI({ apiKey })
		const model = defaults.ai.gemini_chain?.[0] || 'gemini-2.5-flash'
		const prompt = buildAIPrompt(input)

		const callPromise = GoogleAI.models.generateContent({
			model,
			contents: prompt,
			config: {
				systemInstruction:
					'Você é o assistente inteligente oficial do campus universitário (CEUNES/UFES). ' +
					'Sua missão é gerar um resumo matinal diário completo, limpo e direto para WhatsApp, exatamente na estrutura solicitada. ' +
					'Use formatação do WhatsApp (*negrito*, _itálico_). ' +
					'Use traço simples "-" no cabeçalho, NUNCA use travessão "—". ' +
					'Destaque SEMPRE eventos novos ou prioritários de Estudante com sirene 🚨 e em negrito. ' +
					'Se NÃO houver novos eventos iniciados hoje, coloque OBRIGATORIAMENTE a linha "  • _Nada de novo em relação a ontem._" no topo da seção de calendário. ' +
					'Mantenha o texto compacto e legível em uma única tela de celular.',
			},
		})

		// 6 seconds timeout limit
		const timeoutPromise = new Promise<null>((_, reject) =>
			setTimeout(() => reject(new Error('Gemini API timeout')), 6_000)
		)

		const res = await Promise.race([callPromise, timeoutPromise])
		if (res && res.text && res.text.trim().length > 20) {
			return cleanAIOutput(res.text.trim())
		}

		if (typeof print === 'function') {
			print('DAILYSUMMARY', 'Empty or invalid response from Gemini. Falling back.', 'yellow')
		}
		return generateFallbackSummary(input)
	} catch (e: any) {
		if (typeof print === 'function') {
			print(
				'DAILYSUMMARY',
				`Gemini summary generation failed (${e?.message || e}). Using fallback.`,
				'yellow',
			)
		}
		return generateFallbackSummary(input)
	}
}

function cleanAIOutput(text: string): string {
	// Remove markdown code blocks if the model wrapped the response in ```
	let cleaned = text.replace(/^```(?:markdown|whatsapp)?\n?/i, '').replace(/\n?```$/i, '').trim()
	// Replace any em-dash with simple hyphen
	cleaned = cleaned.replace(/—/g, '-')
	return cleaned
}

function formatHeaderTitle(raw: string): string {
	const t = raw.trim()
	if (t.includes('*')) return t
	const match = t.match(
		/^([\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}\u200D\uFE0F\u2600-\u27BF\uE000-\uF8FF\s]+)(.*)$/u,
	)
	if (match && match[2].trim()) {
		return `${match[1].trim()} *${match[2].trim()}*`
	}
	return `*${t}*`
}

function formatBreakfastLine(b: NonNullable<ParsedMenuResult['breakfast']>): string {
	const parts: string[] = []
	if (b.bread) parts.push(`🍞 ${b.bread}`)
	if (b.milk) parts.push('🥛')
	if (b.coffee) parts.push('☕')
	if (b.fruit) parts.push(b.fruit)
	if (b.juice) parts.push(`suco de ${b.juice}`)
	if (parts.length === 0) return ''
	if (parts.length === 1) return parts[0]
	return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`
}

function pushSubItemLines(menuLines: string[], subItems: string[]) {
	for (const item of subItems) menuLines.push(`   ↳ _${item}_`)
}

function buildAIPrompt(input: DailySummaryInput): string {
	const headerTitle = formatHeaderTitle(input.bulletinTitle || '🧠 *Boletim CEUNES*')

	let weatherText = 'Sem dados do clima para hoje.'
	if (input.weather) {
		weatherText =
			`Condição: ${input.weather.condition} (${input.weather.emoji}), Mínima: ${input.weather.tempMin}°C, Máxima: ${input.weather.tempMax}°C, Chuva: ${input.weather.rainProb}%. Dica: ${
				input.weather.tip || 'Nenhuma'
			}`
	}

	let menuText =
		'Cardápio do RU ainda não divulgado para hoje (ou RU fechado). Informe no resumo que o cardápio ainda não foi publicado e que atualizações serão enviadas aqui assim que postarem.'
	if (input.menu && input.menu.hasMenu) {
		const parts: string[] = []
		if (input.menu.breakfast) {
			const b = input.menu.breakfast
			const bData = []
			if (b.bread) bData.push(`Pão: ${b.bread}`)
			if (b.milk) bData.push(`Leite: ${b.milk}`)
			if (b.coffee) bData.push(`Café: ${b.coffee}`)
			if (b.fruit) bData.push(`Fruta: ${b.fruit}`)
			if (b.juice) bData.push(`Suco: ${b.juice}`)
			if (bData.length > 0) parts.push(`Café da manhã: ${bData.join(' | ')}`)
		}
		if (input.menu.lunch) {
			parts.push(
				`Almoço: Prato Principal: ${
					input.menu.lunch.mainDish || 'Não informado'
				} | Opção: ${input.menu.lunch.optionDish || 'Não informada'} | Guarnição: ${
					input.menu.lunch.sideDish || ''
				} | Saladas: ${input.menu.lunch.salads || ''} | Sobremesa: ${
					input.menu.lunch.dessert || ''
				} | Suco: ${input.menu.lunch.juice || ''}`,
			)
		}
		if (input.menu.dinner) {
			parts.push(
				`Jantar: Prato Principal: ${
					input.menu.dinner.mainDish || 'Não informado'
				} | Opção: ${input.menu.dinner.optionDish || 'Não informada'} | Guarnição: ${
					input.menu.dinner.sideDish || ''
				} | Saladas: ${input.menu.dinner.salads || ''} | Sobremesa: ${
					input.menu.dinner.dessert || ''
				} | Suco: ${input.menu.dinner.juice || ''}`,
			)
		}
		menuText = parts.join('\n')
	}

	let calendarText = 'Nenhum evento acadêmico para hoje.'
	if (input.calendar && input.calendar.hasEvents) {
		const lines = []
		if (input.calendar.newStudentEvents.length > 0) {
			lines.push(
				`NOVOS EVENTOS DE ESTUDANTE INICIADOS HOJE: ${
					input.calendar.newStudentEvents.map((e) =>
						`${e.atividade} (${e.dateRange || ''})`
					).join('; ')
				}`,
			)
		} else {
			lines.push(
				`NOVOS EVENTOS INICIADOS HOJE: Nenhum (Use obrigatoriamente a linha "  • _Nada de novo em relação a ontem._")`,
			)
		}

		if (input.calendar.endingTodayEvents.length > 0) {
			lines.push(
				`ÚLTIMO DIA HOJE: ${
					input.calendar.endingTodayEvents.map((e) =>
						`${e.atividade} (Resp: ${e.responsavel || 'Geral'})`
					).join('; ')
				}`,
			)
		}
		if (input.calendar.ongoingStudentEvents.length > 0) {
			lines.push(
				`EM ANDAMENTO (ESTUDANTE): ${
					input.calendar.ongoingStudentEvents.map((e) =>
						`${e.atividade} (${e.dateRange || ''})`
					).join('; ')
				}`,
			)
		}
		calendarText = lines.join('\n')
	}

	return `Gere o resumo diário do campus para a data ${input.dateStr}.

Siga RIGOROSAMENTE esta estrutura:
${headerTitle} - *${input.dateStr}*
[Linha de Clima: ${input.weather ? input.weather.formattedLine : 'Sem dados'}]

🍽️ *Cardápio do RU:*
[Se cardápio NÃO disponível:   • _Cardápio ainda não divulgado (ou RU fechado). Se for publicado mais tarde, enviaremos a atualização aqui!_]
[Se cardápio disponível:
☕ *Café:* 🍞 [tipo pão], 🥛, ☕, [Fruta] e suco de [Suco] (omitir item ausente, sem inventar)
🍛 *Almoço:* [Prato Principal] _(Opção: [Opção])_
   ↳ _[Guarnição]_
   ↳ _Saladas: [Saladas]_
   ↳ _[Sobremesa]_
   ↳ _Suco de [Suco]_ (um item por linha, omitir ausentes)
🍲 *Jantar:* [Prato Principal] _(Opção: [Opção])_
   ↳ _[Guarnição]_
   ↳ _Saladas: [Saladas]_
   ↳ _[Sobremesa]_
   ↳ _Suco de [Suco]_ (um item por linha, omitir ausentes)
]

🎓 *Calendário Acadêmico:*
  (REGRA: Se NÃO houver novos eventos iniciados hoje, coloque OBRIGATORIAMENTE na primeira linha: "  • _Nada de novo em relação a ontem._")
  (Se HOUVER novos prazos de estudantes iniciados hoje, use 🚨 *Estudante:* em negrito)
  (Use ⏳ *Último dia hoje:* para eventos que terminam hoje)
  (Use 📌 *Em andamento:* para prazos relevantes de estudantes)

DADOS DO DIA:
- Data: ${input.dateStr}
- Clima: ${weatherText}
- Cardápio RU:
${menuText}
- Calendário Acadêmico:
${calendarText}

Regras:
1. NUNCA invente pratos ou prazos.
2. Destaque prazos de estudantes com 🚨 e negrito.
3. Não use travessão "—", use apenas traço simples "-".
4. Não adicione dia da semana no cabeçalho, use exatamente "${headerTitle} - *${input.dateStr}*".
5. Café da manhã: use 🍞 + tipo do pão, 🥛 para leite, ☕ para café (ex.: "🍞 francês, 🥛, ☕, maçã e suco de goiaba"); omita itens ausentes sem inventar.`
}

export function generateFallbackSummary(input: DailySummaryInput): string {
	const headerTitle = formatHeaderTitle(input.bulletinTitle || '🧠 *Boletim CEUNES*')
	const sections: string[] = []

	// 1. Header (No weekday, simple hyphen)
	sections.push(`${headerTitle} - *${input.dateStr}*`)

	// 2. Weather
	if (input.weather) {
		sections.push(input.weather.formattedLine)
	}

	// 3. Menu (Option 2 compact format)
	const menuLines: string[] = ['🍽️ *Cardápio do RU:*']
	if (input.menu && input.menu.hasMenu) {
		if (input.menu.breakfast) {
			const bLine = formatBreakfastLine(input.menu.breakfast)
			if (bLine) {
				menuLines.push(`☕ *Café:* ${bLine}`)
			}
		}

		if (input.menu.lunch) {
			let lunchMain = `🍛 *Almoço:* ${input.menu.lunch.mainDish || 'Prato do dia'}`
			if (input.menu.lunch.optionDish) {
				lunchMain += ` _(Opção: ${input.menu.lunch.optionDish})_`
			}
			menuLines.push(lunchMain)

			const subItems = []
			if (input.menu.lunch.sideDish) subItems.push(input.menu.lunch.sideDish)
			if (input.menu.lunch.salads) subItems.push(`Saladas: ${input.menu.lunch.salads}`)
			if (input.menu.lunch.dessert) subItems.push(input.menu.lunch.dessert)
			if (input.menu.lunch.juice) subItems.push(`Suco de ${input.menu.lunch.juice}`)
			pushSubItemLines(menuLines, subItems)
		}

		if (input.menu.dinner) {
			let dinnerMain = `🍲 *Jantar:* ${input.menu.dinner.mainDish || 'Prato do dia'}`
			if (input.menu.dinner.optionDish) {
				dinnerMain += ` _(Opção: ${input.menu.dinner.optionDish})_`
			}
			menuLines.push(dinnerMain)

			const subItems = []
			if (input.menu.dinner.sideDish) subItems.push(input.menu.dinner.sideDish)
			if (input.menu.dinner.salads) subItems.push(`Saladas: ${input.menu.dinner.salads}`)
			if (input.menu.dinner.dessert) subItems.push(input.menu.dinner.dessert)
			if (input.menu.dinner.juice) subItems.push(`Suco de ${input.menu.dinner.juice}`)
			pushSubItemLines(menuLines, subItems)
		}
	} else {
		menuLines.push(
			`  • _Cardápio ainda não divulgado (ou RU fechado). Se for publicado mais tarde, enviaremos a atualização aqui!_`,
		)
	}
	sections.push(menuLines.join('\n'))

	// 4. Calendar (Option 2 compact format)
	if (input.calendar && input.calendar.hasEvents) {
		const calLines: string[] = ['🎓 *Calendário Acadêmico:*']

		if (input.calendar.newStudentEvents.length > 0) {
			for (const e of input.calendar.newStudentEvents) {
				const deadline = e.dateRange ? ` *(até ${getEndDate(e.dateRange)})*` : ''
				calLines.push(`  🚨 *Estudante (Novo hoje):* ${e.atividade}${deadline}`)
			}
		} else {
			calLines.push(`  • _Nada de novo em relação a ontem._`)
		}

		if (input.calendar.endingTodayEvents.length > 0) {
			const endingNames = input.calendar.endingTodayEvents.map((e) => {
				const who = e.responsavel ? ` _(${e.responsavel})_` : ''
				return `${e.atividade}${who}`
			}).join('; ')
			calLines.push(`  ⏳ *Último dia hoje:* ${endingNames}`)
		}

		if (input.calendar.ongoingStudentEvents.length > 0) {
			for (const e of input.calendar.ongoingStudentEvents) {
				const deadline = e.dateRange ? ` *(até ${getEndDate(e.dateRange)})*` : ''
				calLines.push(`  📌 *Em andamento:* ${e.atividade}${deadline}`)
			}
		}

		sections.push(calLines.join('\n'))
	}

	// Single line break between title and weather line, double elsewhere
	if (input.weather && sections.length > 1) {
		return `${sections[0]}\n${sections.slice(1).join('\n\n')}`
	}
	return sections.join('\n\n')
}

function getEndDate(dateRange: string): string {
	const parts = dateRange.split(/\s+a\s+/)
	if (parts.length > 1) {
		return parts[1].trim()
	}
	return dateRange.trim()
}
