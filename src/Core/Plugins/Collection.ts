class Base {
	constructor() {}
}

export default class Collection<N, T extends Base> extends Map {
	base: Base;

	constructor(base: Base, public limit?: num) {
		super();
		this.base = base;
		this.limit = limit;
	}

	update(id: N, obj: T): T {
		if (!id && id !== 0) throw new Error('Missing object id');

		const item = this.get(id);
		if (!item) return this.add(id, obj);

		item.update(id, obj);

		return item;
	}

	add(id: N, obj: T): T {
		//@ts-ignore
		if (this.limit === 0) return this.set(id, obj);

		if (this.limit && this.size > this.limit) {
			const iter = this.keys();
			while (this.size > this.limit) {
				this.delete(iter.next().value);
			}
		}

		return obj;
	}

	every(f: Function): bool {
		for (const item of this.values()) {
			if (!f(item)) return false;
		}
		return true;
	}

	filter(f: Function): T[] {
		const arr = [];

		for (const item of this.values()) {
			if (f(item)) arr.push(item);
		}
		return arr;
	}

	find(f: Function): T | undefined {
		for (const item of this.values()) {
			if (f(item)) return item;
		}
		return undefined;
	}
	map(f: Function): T[] {
		const arr = [];

		for (const item of this.values()) arr.push(f(item));

		return arr;
	}

	random(): T | null {
		const index = Math.floor(Math.random() * this.size);
		const iter = this.values();

		for (let i = 0; i < index; ++i) iter.next();

		return iter.next().value;
	}

	reduce(f: Function, initialValue: any): any {
		const iter = this.values();
		let val;
		let result = initialValue === undefined ? iter.next().value : initialValue;

		while ((val = iter.next().value) !== undefined) {
			result = f(result, val);
		}
		return result;
	}
	remove(id: N): T | null {
		const item = this.get(id);
		if (!item) return null;

		this.delete(id);

		return item;
	}

	some(f: Function): bool {
		for (const item of this.values()) {
			if (f(item)) return true;
		}

		return false;
	}

	toJSON() {
		const json = {};

		// @ts-ignore
		for (const item of this.values()) json[item.id] = item;

		return json;
	}
}
