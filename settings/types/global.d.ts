type str = string
type num = number
type bool = boolean

// you can find these functions on `util/proto.ts`
declare function print(...args: any[]): void

interface String {
	encode(): str
	toPascalCase(): str
	align(limit: num, endPosition?: bool): str
	t(lang: str): str
	filterForRegex(): str
	toMs(): [num, str[]]
	bold(): str
}

interface Number {
	bytes(onlyNumbers?: bool): str | num
	duration(ms?: bool): str
}

interface Reminder {
	id: num
	author: str
	chat: str
	msg: str
	remindAt: str
}

interface aiResponse {
	model: str
	text: str
	tokens: num
	finish?: bool
}
