type str = string;
type num = number;
type bool = boolean;

interface String {
	encode(): str;
	toPascalCase(): str;
	align(limit: num, position: 'start' | 'end'): str;
	toRegEx(): str;
}
