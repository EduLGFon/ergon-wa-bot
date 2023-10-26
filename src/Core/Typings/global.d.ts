type str = string;
type num = number;
type bool = boolean;

interface String {
	encode(): str;
	toPascalCase(): str;
	align(limit: num, position: 'start' | 'end'): str;
	filterForRegex(): str;
}

interface Number {
	bytes(onlyNumbers?: bool): string | number;
}
