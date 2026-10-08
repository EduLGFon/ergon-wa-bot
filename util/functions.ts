// Delay: make the code wait for some time
const delay = async (time: num) => await new Promise((r) => setTimeout(() => r(true), time))

const randomDelay = (min = 2_000, max = 5_000) =>
	delay(min + Math.floor(Math.random() * (max - min)))

// isValidPositiveIntenger: validate a number
const isValidPositiveIntenger = (num: num) => !Number.isNaN(num) && num > 0 && Number.isInteger(num)

// findKey: Search for a key inside an object
function findKey(obj: any, key: str): any {
	// null/primitive nodes (common in proto trees) hold no keys
	if (!obj || typeof obj !== 'object') return

	// if the obj has this key, then return it
	if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key]

	// search the key on all objs inside the main obj
	for (const property of Object.getOwnPropertyNames(obj)) {
		// without this, the msg type could be the quoted msg type.
		if (property === 'quotedMessage' && key !== 'quotedMessage') continue

		const value = obj[property]
		// if the property is a obj, call findKey() recursively
		if (value && typeof value === 'object') {
			const result = findKey(value, key)

			if (result !== undefined) return result
		}

		// If it's a method, check if it is the searched value
		if (typeof value === 'function' && property === key) return value
	}

	return
}

export { delay, findKey, isValidPositiveIntenger, randomDelay }
