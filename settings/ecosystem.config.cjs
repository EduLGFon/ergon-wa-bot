/** PM2 Ecosystem file
 * launcher settings for every app are here
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
		log_file: 'settings/log/walle.log',
	}, {
		name: 'runner',
		script: 'build/plugin/runner.js',
		node_args,
		// interpreter: 'deno',
		// interpreter_args: 'run',
		instances: 4,
		exec_mode: 'cluster',
		log_file: 'settings/log/runner.log',
		merge_logs: true, // marge logs from all intances
	}, {
		name: 'reminder',
		script: 'build/plugin/reminder.js',
		node_args,
		log_file: 'settings/log/reminder.log',
	}],
}
