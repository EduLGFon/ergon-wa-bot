import titlesList from '@conf/bulletinTitles.json' with { type: 'json' }

interface TitleState {
	shuffledOrder: number[]
	currentIndex: number
}

const STATE_FILE = 'conf/gen/cache/bulletin_title_state.json'

function shuffleArray(n: number): number[] {
	const arr = Array.from({ length: n }, (_, i) => i)
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1))
		;[arr[i], arr[j]] = [arr[j], arr[i]]
	}
	return arr
}

async function loadState(): Promise<TitleState> {
	try {
		const text = await Deno.readTextFile(STATE_FILE)
		const state = JSON.parse(text) as TitleState
		if (
			Array.isArray(state.shuffledOrder) &&
			typeof state.currentIndex === 'number' &&
			state.shuffledOrder.length === titlesList.length
		) {
			return state
		}
	} catch (_e) {
		// Ignore not found or corrupted state, reinitialize
	}

	return {
		shuffledOrder: shuffleArray(titlesList.length),
		currentIndex: 0,
	}
}

async function saveState(state: TitleState): Promise<void> {
	try {
		await Deno.mkdir('conf/gen/cache', { recursive: true })
		await Deno.writeTextFile(STATE_FILE, JSON.stringify(state, null, 2))
	} catch (e: any) {
		if (typeof print === 'function') {
			print('TITLES', 'Failed to save bulletin title state', e?.message || e, 'yellow')
		}
	}
}

/**
 * Gets the next bulletin title in the non-repeating cycle and advances the pointer.
 */
export async function getNextBulletinTitle(): Promise<string> {
	const state = await loadState()

	if (state.currentIndex >= state.shuffledOrder.length) {
		state.shuffledOrder = shuffleArray(titlesList.length)
		state.currentIndex = 0
	}

	const chosenIndex = state.shuffledOrder[state.currentIndex]
	const title = titlesList[chosenIndex] || '🧠 *Boletim CEUNES*'

	state.currentIndex++
	await saveState(state)

	return title
}

/**
 * Peeks the current bulletin title without advancing the pointer.
 */
export async function peekCurrentBulletinTitle(): Promise<string> {
	const state = await loadState()
	const index = state.currentIndex < state.shuffledOrder.length ? state.currentIndex : 0
	const chosenIndex = state.shuffledOrder[index]
	return titlesList[chosenIndex] || '🧠 *Resumo do estudante*'
}
