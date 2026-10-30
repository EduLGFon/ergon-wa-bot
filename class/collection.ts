// Capped Map with primary-key helper.
// Backs the user, group, and msg caches with size limits and upserts.
// Prevents unbounded memory growth during long bot sessions.
export default class Collection<K, V> extends Map<K, V> {
	primaryKey: str
	limit: num
	byteBudget: num
	// Running total of entry bytes, maintained on set/delete to avoid O(N) rescan.
	byteTotal: num

	constructor(limit?: num, PK = 'id', byteBudget?: num) {
		super()
		this.primaryKey = PK
		this.limit = limit === 0 ? 0 : limit || 100 // items limit
		this.byteBudget = byteBudget || 0
		this.byteTotal = 0
	}

	// Byte size of a stored value - buffers first, then arrays/strings.
	static entryBytes(value: any): num {
		if (!value) return 0
		if (typeof value.buffer?.length === 'number') return value.buffer.length
		if (typeof value.length === 'number') return value.length
		return 0
	}

	get bytes(): num {
		return this.byteTotal
	}

	// Override set to keep byteTotal in sync and enforce caps.
	set(key: K, value: V): this {
		const existing = this.get(key)
		if (existing !== undefined) {
			this.byteTotal -= Collection.entryBytes(existing)
		}
		this.byteTotal += Collection.entryBytes(value)
		const ret = super.set(key, value)

		// Item limit: evict oldest entries.
		if (this.limit && this.size > this.limit) {
			const iter = this.keys()
			while (this.size > this.limit) {
				const k = iter.next().value as K
				this.delete(k)
			}
		}

		// Byte budget: evict oldest entries until under budget.
		if (this.byteBudget > 0) {
			const iter = this.keys()
			while (this.byteTotal > this.byteBudget && this.size > 0) {
				const k = iter.next().value as K
				this.delete(k)
			}
		}

		return ret
	}

	// Override delete to keep byteTotal in sync.
	delete(key: K): boolean {
		const v = this.get(key)
		if (v !== undefined) this.byteTotal -= Collection.entryBytes(v)
		return super.delete(key)
	}

	// Override clear to reset byteTotal.
	clear(): void {
		super.clear()
		this.byteTotal = 0
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
