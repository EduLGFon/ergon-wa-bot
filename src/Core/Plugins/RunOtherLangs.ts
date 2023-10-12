import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { Lang } from '../Typings';
import { inspect } from 'util';

export const langs: Lang[] = ['py', 'lua', 'deno', 'node', 'eval', 'cpp'];

const langInfo = {
	py: {
		cmd: ['python3 '],
		ext: 'py',
	},
	lua: {
		cmd: ['lua '],
		ext: 'lua',
	},
	deno: {
		cmd: ['deno run -A '],
		ext: 'ts',
	},
	node: {
		cmd: ['node '],
		ext: 'js',
	},
	eval: {
		cmd: ['eval'],
		ext: 'js',
	},
	cpp: {
		cmd: ['g++ -o temp/main -finput-charset=UTF-8 ', './temp/main # '],
		ext: 'cpp',
	},
};

export async function run(lang: Lang, code: str) {
	let output = '';

	if (lang === 'eval') {
		output = code.includes('await')
			? await eval(`(async () => { ${code} })()`)
			: await eval(code);

		output = inspect(output, { depth: null });
	} else {
		const { cmd, ext } = langInfo[lang];

		const file = `temp/exec.${ext}`;

		writeFileSync(file, code);

		output = cmd
			.map((c) => execSync(`${c}${file}`) + '\n\n')
			.join(' ');
	}

	return output.trim().encode();
}
