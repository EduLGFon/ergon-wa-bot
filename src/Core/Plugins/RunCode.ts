import type { CmdContext, Lang } from '../Typings/types.js';
import { delay } from '../Components/Utils.js';
import { execSync } from 'node:child_process';
import { inspect } from 'node:util';
import fs from 'node:fs';

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
		cmd: ['g++ -o temp/main ', './temp/main # '],
		ext: 'cpp',
	},
};

interface runParams {
	lang?: Lang;
	code?: str;
	ctx?: CmdContext;
	file?: string;
}
export async function runCode({ lang, code, ctx, file }: runParams) {
	let data, cli: str[] = [];

	try {
		if (lang === 'eval') {
			const { args, bot, msg, prisma, user, group, cmd, callCmd, t, sendUsage } = ctx!;
			delay; // i may need it, so TS won't remove from build if it's here
			file = import.meta.url;

			let output = code!.includes('await')
				? await eval(`(async () => { ${code} })()`)
				: await eval(code!);

			return inspect(output, { depth: null });
		}

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
