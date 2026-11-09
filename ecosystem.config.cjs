module.exports = {
	apps: [{
		name: 'wa',
		script: 'wa.ts',
		cwd: '/home/io/p/ergon-wa-bot',
		interpreter: '/home/io/.deno/bin/deno',
		node_args: 'run -A --v8-flags=--expose-gc --env=conf/.env',
		out_file: 'conf/gen/out.log',
		error_file: 'conf/gen/err.log',
		merge_logs: true,
		exp_backoff_restart_delay: 1000,
		min_uptime: 10000,
		kill_timeout: 10000,
		autorestart: true,
		treekill: true,
	}],
}
