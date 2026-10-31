// Delay: make the code wait for some time
const delay = async (time: num) => await new Promise((r) => setTimeout(() => r(true), time))

const randomDelay = (min = 2_000, max = 5_000) =>
	delay(min + Math.floor(Math.random() * (max - min)))

// isValidPositiveIntenger: validate a number
const isValidPositiveIntenger = (num: num) => !Number.isNaN(num) && num > 0 && Number.isInteger(num)

// Memoization cache for findKey (WeakMap so objects can be GC'd).
const findKeyCache = new WeakMap<object, Map<string, any>>()

// findKey: Search for a key inside an object
function findKey(obj: any, key: str): any {
	if (!obj || typeof obj !== 'object') return
	const cached = findKeyCache.get(obj)?.get(key)
	if (cached !== undefined || findKeyCache.get(obj)?.has(key)) {
		return findKeyCache.get(obj)!.get(key)
	}
	// null/primitive nodes (common in proto trees) hold no keys
	if (!obj || typeof obj !== 'object') {
		return undefined
	}

	// get or create bucket
	let b = findKeyCache.get(obj)
	if (!b) {
		b = new Map<string, any>()
		findKeyCache.set(obj, b)
	}

	// if the obj has this key, then return it
	if (Object.prototype.hasOwnProperty.call(obj, key)) {
		b.set(key, obj[key])
		return obj[key]
	}

	// search the key on all objs inside the main obj
	let result: any = undefined
	let found = false
	for (const property of Object.getOwnPropertyNames(obj)) {
		// without this, the msg type could be the quoted msg type.
		if (property === 'quotedMessage' && key !== 'quotedMessage') continue

		const value = obj[property]
		// if the property is a obj, call findKey() recursively
		if (value && typeof value === 'object') {
			const r = findKey(value, key)

			if (r !== undefined) {
				result = r
				found = true
				break
			}
		}

		// If it's a method, check if it is the searched value
		if (typeof value === 'function' && property === key) {
			result = value
			found = true
			break
		}
	}

	const final = found ? result : undefined
	b.set(key, final)
	return final
}

export { delay, findKey, isValidPositiveIntenger, randomDelay }
