// Capped Map with primary-key helper.
// Backs the user, group, and msg caches with size limits and upserts.
// Prevents unbounded memory growth during long bot sessions.
export default class Collection<K, V> extends Map<K, V> {
	primaryKey: str
	limit: num
	byteBudget: num

	constructor(limit?: num, PK = 'id', byteBudget?: num) {
		super()
		this.primaryKey = PK
		this.limit = limit === 0 ? 0 : limit || 100 // items limit
		this.byteBudget = byteBudget || 0
	}

	// Byte size of a stored value - buffers first, then arrays/strings.
	static entryBytes(value: any): num {
		if (!value) return 0
		if (typeof value.buffer?.length === 'number') return value.buffer.length
		if (typeof value.length === 'number') return value.length
		return 0
	}

	get bytes(): num {
		let total = 0
		for (const v of this.values()) total += Collection.entryBytes(v)
		return total
	}

	// Add: adds a value to the collection
	// deno-lint-ignore require-await
	async add(key: K, value?: V | object): Promise<V> {
		if (!key) throw new Error('Missing object key')

		if (!value) {
			value = key
			key = (this.size || 0) as K
		}

		const existing = this.get(key)
		if (existing) {
			if (!value) return existing as V
			// Merge: existing fields take priority over new ones
			// Object.assign(value, existing) mutates value and preserves its prototype
			value = Object.assign(value, existing) as V
		}

		this.set(key, value as V)

		if (this.limit && this.size > this.limit) {
			const iter = this.keys()
			while (this.size > this.limit) {
				this.delete(iter.next().value as K)
			}
		}

		// Byte budget: evict oldest entries until under budget.
		if (this.byteBudget > 0) {
			let total = this.bytes
			const iter = this.keys()
			while (total > this.byteBudget && this.size > 0) {
				const k = iter.next().value as K
				const v = this.get(k)
				this.delete(k)
				total -= Collection.entryBytes(v)
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

	// Reverse: reverse items on a array
	reverse(): V[] {
		return Array.from(this.values()).reverse()
	}

	// toJSON: Returns a JSON object containing the id: value pairs
	toJSON() {
		const json: Record<string, unknown> = {}

		for (const [k, v] of this.entries()) json[String(k)] = v

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
