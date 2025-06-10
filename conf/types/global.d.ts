type str = string
type num = number
type bool = boolean
type Buf = Buffer
type Func = Function

// you can find these functions on `util/proto.ts`
declare function print(...args: any[]): void

interface String {
	getUrl(): str[] | null
	encode(): str
	parsePhone(): str
	toPascalCase(): str
	align(limit: num, char?: str, endPosition?: bool): str
	t(lang: str, options?: any): str
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
	author: num
	chat: str
	msg: str
	remindAt: str
	isDone: bool
}

interface aiPrompt {
	instruction?: str
	prompt: str | [Part, str]
	model?: str
	buffer?: Buf
	mime?: str
	user?: User
}

interface aiResponse {
	text: str
	tokens?: num
}
