type str = string
type num = number
type bool = boolean

interface String {
	encode(): str
	toPascalCase(): str
	align(limit: num, endPosition?: boolean): str
	filterForRegex(): str
}

interface Number {
	bytes(onlyNumbers?: bool): string | number
}
