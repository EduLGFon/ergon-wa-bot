// Global str, num, print, and buffer aliases.
// Provides shorthand types and proto helpers used across the codebase.
// Removes repetitive imports for common utilities.
// Buf is Uint8Array internally; wrap with Buffer.from only at the
// Baileys send/getStream boundary which requires Node Buffer.
type str = string
type num = number
type bool = boolean
type Buf = Uint8Array
type Func = (...args: any[]) => any

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

type UserDB = {
	// user db typescript schema
	id: num
	lid: str
	name: str | null
	lang: str | null
	prefix: str | null
	cmds: num | null
	memories: str | null
}

interface Media {
	buffer: Buf
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

type Lang =
	| 'py'
	| 'lua'
	| 'rs'
	| 'node'
	| 'deno'
	| 'bun'
	| 'bash'
	| 'zsh'
	| 'cpp'
	| 'eval'
// supported programming languages
