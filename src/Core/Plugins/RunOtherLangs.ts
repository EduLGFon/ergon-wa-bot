import type { CmdContext, Lang } from '../Typings/index.d.ts';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { inspect } from 'node:util';

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

interface runParams {
	lang?: Lang;
	code?: str;
	ctx?: CmdContext;
	file?: string;
}
export async function runOtherLang({ lang, code, ctx, file }: runParams) {
	if (lang === 'eval') {
		const { args, bot, msg, prisma, user, group, cmd, callCmd, t, sendUsage } = ctx!;

		let output = code!.includes('await')
			? await eval(`(async () => { ${code} })()`)
			: await eval(code!);

		return inspect(output, { depth: null });
	}

	let data;

	if (file) {
		lang = file.split('.')[1] as 'py';

		data = langInfo[lang];
	} else {
		data = langInfo[lang!];

		file = `temp/exec.${data.ext}`;
		writeFileSync(file, code!);
   code = '';
   // don't write code in CLI to prevent issues
	}

	return data.cmd!
		.map((c) => execSync(`${c}${file} ${code}`) + '\n\n')
		.join(' ');
}
