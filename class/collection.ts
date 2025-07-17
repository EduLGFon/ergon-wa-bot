export default class Collection<K, V> extends Map {
	primaryKey: str
	limit: num

	constructor(limit?: num, PK = 'id') {
		super()
		this.primaryKey = PK
		this.limit = limit === 0 ? 0 : limit || 100 // items limit
	}

	get(key: K): V {
		return super.get(key) as V
	}

	// Add: adds a value to the collection
	async add(key: K, value?: V | object, extra: any[] = []): Promise<V> {
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

		this.set(key, value as V)

		if (this.limit && this.size > this.limit) {
			const iter = this.keys()
			while (this.size > this.limit) {
				this.delete(iter.next().value)
			}
		}

		return value as V
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

	// Reduce: same as Array#reduce
	reduce(func: (preValue: V, nextValue: V) => V, initialValue = 0): any {
		const items = this.values()
		let next
		let previous = initialValue || items.next().value

		while ((next = items.next().value) !== undefined) {
			previous = func(previous, next)
		}

		return previous
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
