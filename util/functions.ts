// Delay: make the code wait for some time
const delay = async (time: num) => await new Promise((r) => setTimeout(() => r(true), time))

const randomDelay = async (min = 2_000, max = 5_000) => delay(min + Math.floor(Math.random() * max))

// isValidPositiveIntenger: validate a number
const isValidPositiveIntenger = (num: num) => !Number.isNaN(num) && num > 0 && Number.isInteger(num)

// findKey: Search for a key inside an object
function findKey(obj: any, key: str): any {
	// if the obj has this key, then return it
	if (obj?.hasOwnProperty(key)) return obj[key]

	// search the key on all objs inside the main obj
	for (const property of Object.getOwnPropertyNames(obj)) {
		// without this, the msg type could be the quoted msg type.
		if (property === 'quotedMessage' && key !== 'quotedMessage') continue

		const value = obj[property]
		// if the property is a obj, call findKey() recursively
		if (typeof value === 'object') {
			const result = findKey(value, key)

			if (result !== undefined) return result
		}

		// If it's a method, check if it is the searched value
		if (typeof value === 'function' && property === key) return value
	}

	return
}

// Validate whether a variable actually has a useful value
function isEmpty(value: unknown): bool { // check if a array/obj is empty
	if (!value) return true

	if (Array.isArray(value)) {
		return value.length === 0 ||
			value.some((item) => item === undefined || isEmpty(item))
	} else if (typeof value === 'object') {
		return Object.keys(value!).length === 0 ||
			!Object.values(value!).some((item) => item !== undefined && item !== null)
	}

	return true
}

export { delay, findKey, isEmpty, isValidPositiveIntenger, randomDelay }
