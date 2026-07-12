export default class Collection<K, V> extends Map<K, V> {
	primaryKey: str
	limit: num

	constructor(limit?: num, PK = 'id') {
		super()
		this.primaryKey = PK
		this.limit = limit === 0 ? 0 : limit || 100 // items limit
	}

	get(key: K): V | undefined {
		return super.get(key)
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
			if (!value) return existing as V
			value = Object.assign(value, existing) as V
		}

		this.set(key, value as V)

		if (this.limit && this.size > this.limit) {
			const iter = this.keys()
			while (this.size > this.limit) {
				this.delete(iter.next().value as K)
			}
		}

		return value as V
	}

	// Filter: same as Array#filter
	filter(func: (item: V) => any): V[] {
		const res: V[] = []

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
		const arr: T[] = []

		for (const item of this.values()) arr.push(func(item))

		return arr
	}

	// Reduce: same as Array#reduce
	reduce(func: (preValue: V, nextValue: V) => V, initialValue?: V): V {
		const items = this.values()
		let next = items.next()
		let previous: V

		if (initialValue !== undefined) {
			previous = initialValue
		} else if (next.value !== undefined) {
			previous = next.value
			next = items.next()
		} else {
			throw new TypeError('Reduce of empty collection with no initial value')
		}

		while (next.value !== undefined) {
			previous = func(previous, next.value)
			next = items.next()
		}

		return previous
	}

	// Reverse: reverse items on a array
	reverse(): V[] {
		return Array.from(this.values()).reverse()
	}

	// toJSON: Returns a JSON object containing the id: value pairs
	toJSON() {
		const json: Record<string, unknown> = {}

		// @ts-ignore json obj does not have a type
		for (const [k, v] of this.entries()) json[k] = v

		return json
	}

	// iterate: itereate entries of an object and add it
	iterate(obj: any) {
		if (!obj) return

		for (const [k, v] of Object.entries(obj)) {
			this.add(k as unknown as K, v as V)
		}
	}
}
