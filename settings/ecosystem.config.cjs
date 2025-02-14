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
		out_file: 'settings/log/output.txt', // only output log
		error_file: 'settings/log/error.txt', // only error log
	}],
}
