// import bc, { workerMsg } from '../Components/WorkerUtil.js';
import type { Lang } from '../Typings/types.js';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

export const langs: Lang[] = ['py', 'lua', 'deno', 'node', 'cpp'];

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
	cpp: {
		cmd: ['g++ -o temp/main ', './temp/main # '],
		ext: 'cpp',
	},
};

interface Params {
	lang?: Lang;
	code?: str;
	file?: string;
}

// bc.onMsg = async (msg: workerMsg) => {
// 	if (msg.target !== 'run') return;

// 	bc.send({
// 		text: await runCode(msg.data),
// 	});
// };

export async function runCode({ lang, code, file }: Params) {
	let data, cli: str[] = [];

	try {
		if (file) {
			lang = file.split('.')[1] as 'py';

			data = langInfo[lang];
		} else {
			data = langInfo[lang!];

			file = `temp/exec.${data.ext}`;
			fs.writeFileSync(file, code!);
			code = '';
			// don't write code in CLI to prevent issues
		}

		return data.cmd!
			.map((c, i) => {
				cli[i] = `${c}${file} ${code}`; // collect CLIs

				return execSync(cli[i]);
			})
			.join(' ');
	} catch (e: any) {
		const regex = `(${cli.join('|').filterForRegex()})`;

		return String(e?.message || e)
			.replace(`Command failed: `, '') // clean errors
			.replace(new RegExp(regex, 'gi'), '') // remove cli
			.replace(new RegExp(file!.filterForRegex(), 'gi'), 'file'); // remove file name

		// i made it bc C++ error logs are strogonoffcaly large
	}
}
