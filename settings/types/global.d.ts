type str = string
type num = number
type bool = boolean

function print(...args): void

interface String {
	encode(): str
	toPascalCase(): str
	align(limit: num, endPosition?: boolean): str
	filterForRegex(): str
}

interface Number {
	bytes(onlyNumbers?: bool): string | number
}

interface aiResponse {
	model: str
	reason: str
	text: str
	promptTokens: number
	responseTokens: number
}
