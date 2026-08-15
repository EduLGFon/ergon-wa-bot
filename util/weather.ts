import defaults from '@conf/defaults.json' with { type: 'json' }

export interface WeatherReport {
	condition: string
	emoji: string
	tempMin: number
	tempMax: number
	apparentTempMax: number
	rainProb: number
	rainSumMm: number
	tip: string
	formattedLine: string
}

const WMO_MAP: Record<number, { text: string; emoji: string }> = {
	0: { text: 'Céu limpo / Ensolarado', emoji: '☀️' },
	1: { text: 'Predomínio de sol', emoji: '🌤️' },
	2: { text: 'Parcialmente nublado', emoji: '⛅' },
	3: { text: 'Nublado', emoji: '☁️' },
	45: { text: 'Nevoeiro', emoji: '🌫️' },
	48: { text: 'Nevoeiro com geada', emoji: '🌫️' },
	51: { text: 'Garoa leve', emoji: '🌦️' },
	53: { text: 'Garoa moderada', emoji: '🌦️' },
	55: { text: 'Garoa densa', emoji: '🌧️' },
	56: { text: 'Garoa gélida', emoji: '🌧️' },
	57: { text: 'Garoa gélida densa', emoji: '🌧️' },
	61: { text: 'Chuva leve', emoji: '🌦️' },
	63: { text: 'Chuva moderada', emoji: '🌧️' },
	65: { text: 'Chuva forte', emoji: '🌧️' },
	66: { text: 'Chuva congelante leve', emoji: '🌧️' },
	67: { text: 'Chuva congelante forte', emoji: '🌧️' },
	71: { text: 'Neve leve', emoji: '🌨️' },
	73: { text: 'Neve moderada', emoji: '🌨️' },
	75: { text: 'Neve forte', emoji: '🌨️' },
	77: { text: 'Granizo miúdo', emoji: '🌨️' },
	80: { text: 'Pancadas de chuva leve', emoji: '🌦️' },
	81: { text: 'Pancadas de chuva', emoji: '🌧️' },
	82: { text: 'Pancadas de chuva violenta', emoji: '⛈️' },
	85: { text: 'Pancadas de neve leve', emoji: '🌨️' },
	86: { text: 'Pancadas de neve forte', emoji: '🌨️' },
	95: { text: 'Tempestade / Trovoadas', emoji: '⛈️' },
	96: { text: 'Tempestade com granizo leve', emoji: '⛈️' },
	99: { text: 'Tempestade com granizo forte', emoji: '⛈️' },
}

export async function fetchWeatherForecast(
	customLat?: number,
	customLon?: number,
): Promise<WeatherReport | null> {
	try {
		const lat = customLat ??
			(Deno.env.get('CAMPUS_LAT')
				? parseFloat(Deno.env.get('CAMPUS_LAT')!)
				: defaults.campus?.lat ?? -18.6758348)
		const lon = customLon ??
			(Deno.env.get('CAMPUS_LONG')
				? parseFloat(Deno.env.get('CAMPUS_LONG')!)
				: defaults.campus?.long ?? -39.8623881)
		const timezone = Deno.env.get('TZ') ??
			'America/Sao_Paulo'

		const url =
			`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,precipitation_sum&timezone=${
				encodeURIComponent(timezone)
			}&forecast_days=1`

		const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
		if (!res.ok) {
			if (typeof print === 'function') {
				print('WEATHER', `Open-Meteo returned status ${res.status}`, 'yellow')
			}
			return null
		}

		const data = await res.json()
		const daily = data.daily
		if (!daily || !daily.weather_code || daily.weather_code.length === 0) {
			return null
		}

		const weatherCode = daily.weather_code[0] as number
		const tempMax = Math.round(daily.temperature_2m_max[0])
		const tempMin = Math.round(daily.temperature_2m_min[0])
		const apparentMax = Math.round(daily.apparent_temperature_max[0])
		const rainProb = Math.round(daily.precipitation_probability_max[0] ?? 0)
		const rainSum = daily.precipitation_sum?.[0] ?? 0

		const wmo = WMO_MAP[weatherCode] || { text: 'Tempo aberto', emoji: '🌤️' }

		// Smart compact tip
		let tip = ''
		if (rainProb >= 40 || rainSum >= 2) {
			tip = 'Leve guarda-chuva! ☂️'
		} else if (apparentMax >= 32 || tempMax >= 32) {
			tip = 'Muito calor, hidrate-se! 💧'
		} else if (tempMin <= 16) {
			tip = 'Manhã/noite fresca! 🧥'
		}

		let formattedLine =
			`${wmo.emoji} *Clima no campus:* ${wmo.text}, ${tempMin}-${tempMax}°C • ${rainProb}% chuva`
		if (tip) {
			formattedLine += ` (${tip})`
		}

		return {
			condition: wmo.text,
			emoji: wmo.emoji,
			tempMin,
			tempMax,
			apparentTempMax: apparentMax,
			rainProb,
			rainSumMm: rainSum,
			tip,
			formattedLine,
		}
	} catch (e: any) {
		if (typeof print === 'function') {
			print('WEATHER', 'Failed to fetch weather forecast', e?.message || e, 'red')
		}
		return null
	}
}
