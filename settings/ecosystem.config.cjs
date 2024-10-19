const node_args = [
	'--expose-gc',
	// '--no-warnings',
	'--env-file=settings/.env',
]

module.exports = {
	apps: [
		{
			name: 'wa_main',
			script: 'main.js',
			node_args,
			// exec_mode: 'cluster',
			// instances: 2,
			out_file: 'settings/log/output.log',
			error_file: 'settings/log/error.log',
		},
		{
			name: 'runner',
			script: 'plugin/runner.ts',
			interpreter: 'deno',
			interpreter_args: '-A',
			log_file: 'settings/log/runner.log',
		},
	],
}
