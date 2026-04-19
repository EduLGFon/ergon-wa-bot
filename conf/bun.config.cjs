/** PM2 Ecosystem file:
 * launcher settings for every app are here
 * See pm2 documentation for more info:
 * https://pm2.keymetrics.io/docs/usage/application-declaration/
 */
const runtime_args = [
	'--expose-gc',
	// '--max-old-space-size=16384',
	'--env-file=conf/.env',
	'--hot'
]

module.exports = { // yea, i really need to use module.exports. don't rage!
	apps: [{ // pm2 launch settings
		name: 'wa',
		script: 'wa.ts', /// main file
		interpreter: 'bun',
		interpreter_args: runtime_args,
		env: {
			NODE_EXTRA_CA_CERTS: 'conf/smufeschain.pem',
        },
		log_file: 'conf/gen/out.log',
		merge_logs: true,

	}],
}
