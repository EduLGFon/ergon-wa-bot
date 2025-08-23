type str = string
type num = number
type bool = boolean
type Buf = Buffer
type Func = Function

// you can find these (print, str, num) functions on `util/proto.ts`
declare function print(...args: any[]): void

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

type UserSchema = { // user db typescript schema
	id: num
	phone: str
	name: str | null
	lang: str | null
	prefix: str | null
	cmds: num | null
	memories: str | null
}

type Alarm = { // alarm db schema
	id: num
	author: num
	chat: str
	msg: str
	time: str
	status: int
}

interface Media {
	buffer: Buff<ArrayBufferLike>
	url: str
	mime: str
	length: num
	duration: num
	type: str
	height?: num
	width?: num
}

interface MediaMsg {
	url: str
	directPath: str
	mediaKey: str
	thumbnailDirectPath: str
}

type AIMsg = { header: str; text: str }

type StreamMsg = { msg: Msg; chat: str }
type Lang = 'py' | 'lua' | 'rs' | 'node' | 'deno' | 'bun' | 'fish' | 'zsh' | 'cpp' | 'eval'
// supported programming languages
