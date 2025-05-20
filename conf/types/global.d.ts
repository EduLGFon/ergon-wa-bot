// Same meaning, writing less
type str = string
type num = number
type bool = boolean
type Buf = BufferSource
type Func = (...args: any[]) => any

// check util/proto.ts to see these functions
interface String {
	align(limit: num, char?: str, endPosition?: bool): str
	toBlob(): Blob
	toMs(): [num, str[]]
}

// check util/proto.ts to see these functions
interface Number {
	bytes(): str
	duration(ms?: bool): str
}

// user database typescript schema
type UserSchema = {
	id?: num
	name?: str
	phone?: str
	telegram?: num
	lang?: str
	prefix?: str
	cmds: num
	memories: str
}

// reminder database typescript schema
type Reminder = {
	id: num
	author: num
	chat: str
	msg: str
	time: str
	status: num
}

type AITokens = { total: num; thoughts: num }
type AIMsg = { header: str; text: str }
