type str = string
type num = number
type bool = boolean
type Buf = Buffer
type Func = Function

// you can find these functions on `util/proto.ts`
declare function print(...args: any[]): void
declare module 'node-webpmux'
interface String {
	align(limit: num, char?: str, endPosition?: bool): str
	toMs(): [num, str[]]
	getUrl(): str[] | undefined
	encode(): str
	parsePhone(): str
	toPascalCase(): str
	t(lang: str, options?: any): str
	filterForRegex(): str
	bold(): str
}

interface Number {
	bytes(): str
	duration(ms?: bool): str
}

// alarm database typescript schema
type Alarm = {
	id: num
	author: num
	chat: str
	msg: str
	time: str
	status: int
}

interface Media {
	buffer: Buf
	mime: str
	length: num
	duration: num
	type: str
	height?: num
	width?: num
}

type AIMsg = { header: str; text: str; tokens: num; thoughts: num }

type Lang = 'py' | 'lua' | 'node' | 'deno' | 'bun' | 'zsh' | 'cpp'
// supported programming languages
