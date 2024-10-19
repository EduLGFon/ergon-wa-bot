const node_args = [
	'--expose-gc',
	'--no-warnings',
	'--env-file=settings/.env',
]

module.exports = {
	apps: [
		{
			name: 'wa_main',
			script: 'build/main.js',
			node_args,
			// exec_mode: 'cluster',
			// instances: 2,
			out_file: 'settings/log/wa_main.log',
			error_file: 'settings/log/wa_error.log',
		},
		{
			name: 'runner',
			script: 'plugin/runner.ts',
			interpreter: 'deno',
			interpreter_args: 'run -A',
			log_file: 'settings/log/runner.log',
		},
	],
}
