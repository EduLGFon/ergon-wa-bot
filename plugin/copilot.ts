/** Copilot:
 * It's something like a devkit to help me coding
 * It will:
 * Run on DENO, so Node TypeScript will report several problems on this file
 * (Enable DENO extension to edit it)
 * Watch files, compile and format when I save it automatically
 * Run scripts
 * Run eval
 * etc
 */
import $ from 'dax'

const controller = new AbortController()
const node_args = ['--expose-gc', '--no-warnings', '--env-file=settings/.env']
const receipes = {
	out: { cmd: 'npm outdated' },
	up: { cmd: 'npm run update' },
	gen: { cmd: 'npm run prisma:gen' },
	pull: { cmd: 'npm run prisma:pull' },
	tsc: { cmd: 'tsc --watch', controller },
	wa: { cmd: `node ${node_args} build/main.js` },
	ru: { cmd: `node ${node_args} build/plugin/runner.js}` },
	re: { cmd: `node ${node_args} build/plugin/reminder.js}` },
	pm2: { cmd: 'pm2 start settings/ecosystem.config.cjs --attach' },
}

const tasks = {
	s(args: string[]) {
		console.log('Start:', ...args)
		args.forEach((a) => {
			//@ts-ignore s
			receipes[a].controller = spawn(receipes[a].cmd)
		})
	},
	k(args: string[]) {
		console.log('Killing:', ...args)
		//@ts-ignore s
		args.forEach((a) => receipes[a].controller.abort())
	},
	r(args: string[]) {
		console.log('Restarting:', ...args)
		args.forEach((a) => {
			const recipe = receipes[a as 'tsc']
			recipe.controller.abort()
			recipe.controller = spawn(recipe.cmd)
		})
	},
	c() {
		console.clear()
	},
}

ask()
watch()

async function ask() {
	const input = await $.prompt('$ ')

	const args = input.split(' ')
	const cmd = args.shift()! as 's'

	const func = tasks[cmd]
	if (func) func(args)
	else spawn(input)
	await ask()
	return
}

function spawn(cmd: string) {
	const args = cmd.split(' ')
	cmd = args.shift()! as string

	if (!cmd) cmd = 'echo'

	const control = new AbortController()
	const _child = new Deno.Command(cmd, {
		args,
		signal: control.signal,
	}).spawn()

	return control
}

async function watch() {
	console.log('Watching!')
	const watcher = Deno.watchFs(`${Deno.cwd()}/`)
	for await (const event of watcher) {
		if (event.kind === 'modify') spawn('deno fmt ./ --config=settings/deno.jsonc')
	}
}
