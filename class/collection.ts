export default class Collection<K, V> extends Map<K, V> {
	primaryKey: str
	limit: num
	base?: FunctionConstructor

	constructor(limit?: num, base?: any, PK = 'id') {
		super()
		this.primaryKey = PK
		this.limit = limit === 0 ? 0 : limit || 100 // items limit
		this.base = base
	}

	// Add: adds a value to the collection
	add(key: K, value?: V | object): V {
		if (!key) throw new Error('Missing object key')

		if (!value) {
			value = key
			key = (this.size || 0) as K
		}

		const existing = this.get(key)
		if (existing) {
			if (!value) return existing
			value = Object.assign(value, existing)
		}

		// if (this.base) {
		// 	value = (value instanceof this.base ||
		// 			value?.constructor?.name === this.base.name)
		// 		? value
		// 		// @ts-ignore
		// 		: new this.base(key, value, ...extra)

		// 	try {
		// 		// @ts-ignore check item data automaticaly
		// 		value = await value.checkData()
		// 	} catch {}
		// }

		this.set(key, value as V)

		if (this.limit && this.size > this.limit) {
			const iter = this.keys()
			while (this.size > this.limit) {
				this.delete(iter.next().value!)
			}
		}

		return value as V
	}

	// Update: updates a item in the collection
	update(key: K, value: V): V {
		if (!key) throw new Error('Missing object key')

		const item = this.get(key)
		if (!item) return this.add(key, value)

		value = Object.assign(item, value)
		this.set(key, value)

		return item
	}

	// Filter: same as Array#filter
	filter(func: (item: V) => any): V[] {
		const res = []

		for (const item of this.values()) {
			if (func(item)) res.push(item)
		}

		return res
	}

	// Find: same as Array#find
	find(func: (item: V) => any): V | undefined {
		for (const item of this.values()) {
			if (func(item)) return item
		}

		return undefined
	}

	// Map: same as Array#map
	map<T>(func: (item: V) => T): T[] {
		const arr = []

		for (const item of this.values()) arr.push(func(item))

		return arr
	}

	// Random: returns a random item of the Map
	random(): V {
		const index = Math.floor(Math.random() * this.size)
		const iter = this.values()

		for (let c = 0; c < index; ++c) iter.next()

		return iter.next().value!
	}

	// Every: Returns true if all items pass in the check
	// Returns false if one item does not pass in the function
	every(func: (item: V) => bool): bool {
		for (const item of this.values()) {
			if (!func(item)) return false
		}

		return true
	}

	// Some: Returns true if some item passes in the function
	some(func: (item: V) => any): bool {
		for (const item of this.values()) {
			if (func(item)) return true
		}

		return false
	}

	// Reduce: same as Array#reduce
	// reduce(func: (preValue: V, nextValue: V) => V, initialValue = 0): any {
	// 	const items = this.values()
	// 	let next
	// 	let previous = initialValue || items.next().value

	// 	while ((next = items.next().value) !== undefined) {
	// 		previous = func(previous, next)
	// 	}

	// 	return previous
	// }

	// Remove: what do you think this method does?
	remove(id: K): V | null {
		const item = this.get(id)
		if (!item) return null

		this.delete(id)

		return item
	}

	// Reverse: reverse items on a array
	reverse(): V[] {
		return this.map((i) => i).reverse()
	}

	// toJSON: Returns a JSON object containing the id: value pairs
	toJSON() {
		const json = {}

		// @ts-ignore json obj does not have a type
		for (const [k, v] of this.entries()) json[k] = v

		return json
	}

	// iterate: itereate entries of an object and add it
	iterate(obj: any) {
		if (!obj) return

		for (const [k, v] of Object.entries(obj)) {
			this.add(k as K, v as V)
		}
	}
}
