/** PM2 Ecosystem file:
 * launcher settings for every app are here
 * See pm2 documentation for more info:
 * https://pm2.keymetrics.io/docs/usage/application-declaration/
 */
const runtime_args = [
	'run',
	'-A',
	'--v8-flags=--expose-gc',
	'--env=conf/.env',
	// '--max-old-space-size=16384',
]

module.exports = { // yea, i really need to use module.exports. don't rage!
	apps: [{ // pm2 launch settings
		name: 'wa',
		script: 'wa.ts', /// main file
		interpreter: 'deno',
		interpreter_args: runtime_args,
		env: {
			NODE_EXTRA_CA_CERTS: 'conf/smufesrootca.pem',
		},
		// Split stdout/stderr so crashes do not drown relay logs. PM2 has
		// no built-in size rotation - install pm2-logrotate once on the
		// host (see scripts/setup-logrotate.sh note below) with:
		//   pm2 install pm2-logrotate
		//   pm2 set pm2-logrotate:max_size 50M
		//   pm2 set pm2-logrotate:retain 7
		//   pm2 set pm2-logrotate:compress true
		log_file: 'conf/gen/out.log',
		out_file: 'conf/gen/out.log',
		error_file: 'conf/gen/err.log',
		merge_logs: true,
		log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS Z',
		// Prod showed 38h/33h dead gaps after fatal crashes: PM2 must always restart.
		// No max_memory_restart by operator choice; in-process guards own recovery.
		autorestart: true,
		min_uptime: 10_000, // must stay up 10s to count as success (prevents login-spam loops)
		exp_backoff_restart_delay: 1_000, // Starts at 100ms, exponentially increases up to 15s to prevent login spam
		listen_timeout: 10_000,
		kill_timeout: 10_000, // give cache.save() on SIGTERM time to flush
	}],
}
