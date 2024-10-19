export default function () {
	Object.defineProperties(String.prototype, {
		toPascalCase: {
			value: function () {
				return this.slice(0, 1).toUpperCase() + this.slice(1);
			},
		},
		encode: {
			value: function () {
				return '```\n' + this + '```';
			},
		},
	});
}
