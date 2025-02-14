/** PM2 Ecosystem file:
 * launcher settings for every app are here
 * See pm2 documentation for more info:
 * https://pm2.keymetrics.io/docs/usage/application-declaration/
 */
const node_args = [
	'--expose-gc',
	'--no-warnings',
	'--env-file=settings/.env',
]

module.exports = { // yea, i really need to use module.exports. don't rage!
	apps: [{ // pm2 launch settings
		name: 'walle',
		script: 'build/main.js', /// main file
		node_args,
		out_file: 'settings/log/walle.log', // only output log
		error_file: 'settings/log/walle.err', // only error log
	}, {
		name: 'runner',
		script: 'build/plugin/runner.js',
		node_args,
		// interpreter: 'deno',
		// interpreter_args: 'run',
		// instances: 1,
		// exec_mode: 'cluster',
		log_file: 'settings/log/runner.log', // both error and output log
		// merge_logs: true, // merge logs from all intances
	}]
}
