const node_args = [
	'--expose-gc',
	'--no-warnings',
	'--env-file=settings/.env',
]

module.exports = {
	apps: [
		{
			name: 'walle',
			script: 'build/main.js',
			node_args,
			log_file: 'settings/log/walle.log',
		},
		{
			name: 'runner',
			script: 'build/plugin/runner.js',
			node_args,
			// interpreter: 'deno',
			// interpreter_args: 'run',
			instances: 4,
			exec_mode: 'cluster',
			log_file: 'settings/log/runner.log',
			merge_logs: true,
		},
	],
}
