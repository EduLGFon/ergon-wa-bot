// setup-wizard - main prompt loop - Deno-only
// - uses Deno-Command for process control - no npm
import { runLightSetup, runMediumSetup, runStrongSetup } from './runners.ts'
import { isWin, join, runCmd, runUpdate } from './runners.ts'
import { runResetLight, runResetStrong } from './reset.ts'
import { configureEnv, existsSync } from './env.ts'
import { loadEnv } from './reset.ts'

// 4 - Start-Restart bot
export function runStartForeground() {
	console.log('\n=========================================')
	console.log('     Starting Bot in Foreground          ')
	console.log('=========================================')
	console.log('Press Ctrl+C or close the terminal to terminate the bot process.')

	const envExtra = {
		NODE_EXTRA_CA_CERTS: 'conf/smufesrootca.pem',
	}

	const cmd = new Deno.Command('deno', {
		args: ['run', '-A', '--env=conf/.env', 'wa.ts'],
		stdin: 'inherit',
		stdout: 'inherit',
		stderr: 'inherit',
		env: { ...Deno.env.toObject(), ...envExtra },
	})

	const child = cmd.spawn()
	return child.status.then((status) => {
		console.log(`\nBot process exited with code ${status.code}`)
	})
}

export function runStartBackground() {
	console.log('\n--- Starting in Background (PM2) ---')
	// Check if process wa is already in PM2 list
	const pm2Cmd = isWin ? 'pm2.cmd' : 'pm2'
	let isPM2Running = false
	try {
		const checkPM2 = new Deno.Command(pm2Cmd, { args: ['describe', 'wa'] }).outputSync()
		isPM2Running = checkPM2.success
	} catch (_e) { /* noop */ }

	if (isPM2Running) {
		console.log('Bot is already running in PM2. Restarting it...')
		runCmd('pm2', ['restart', 'wa'])
	} else {
		console.log('Starting bot with PM2 ecosystem config...')
		runCmd('pm2', ['start', 'conf/ecosystem.config.cjs'])
	}
	console.log('Background process launched. Run PM2 stop to terminate.')
}

// 5 - Stop bot
export function runStop() {
	console.log('\n--- Stopping PM2 Process ---')
	runCmd('pm2', ['delete', 'wa'])
	console.log('Bot process stopped/deleted from PM2.')
}

// MAIN WIZARD LOOP
export async function main() {
	loadEnv()

	// If .env does not exist force configuration first
	if (!existsSync(join('conf', '.env'))) {
		console.log('\nWelcome! No configuration file (.env) was found.')
		console.log('Launching Configuration Wizard first...')
		await configureEnv(null)
	}

	let exit = false
	while (!exit) {
		console.log('\n=========================================')
		console.log('      Ergon WA Bot Setup and Manager      ')
		console.log('=========================================')
		console.log('1. Setup (Install dependencies and environment)')
		console.log('2. Update (Pull code changes and update packages)')
		console.log('3. Start / Restart')
		console.log('4. Stop')
		console.log('5. Reset (Delete local session data or database keys)')
		console.log('6. Exit')

		const choice = prompt('\nSelect an option [1-6]: ')

		switch ((choice || '').trim()) {
			case '1': {
				console.log('\nSetup Options:')
				console.log('  1. Light: Minimum packages to run (npm install only)')
				console.log(
					'  2. Medium: Light setup + Python dependencies (Background removal and Video download)',
				)
				console.log('  3. Strong: Medium setup + Database migration (Drizzle push)')
				console.log(
					'  4. Re-configure Environment (.env, defaults.json and Telegram bridge)',
				)
				console.log('  5. Back')
				const setupChoice = prompt('\nChoose setup level [1-5]: ')
				if (setupChoice === '1') await runLightSetup()
				else if (setupChoice === '2') await runMediumSetup()
				else if (setupChoice === '3') await runStrongSetup()
				else if (setupChoice === '4') await configureEnv(null)
				break
			}
			case '2': {
				await runUpdate()
				break
			}
			case '3': {
				console.log('\nProcess Management:')
				console.log('  1. Start in Foreground (Active interactive shell)')
				console.log('  2. Start in Background (PM2 process runner)')
				console.log('  3. Back')
				const startChoice = prompt('\nChoose run mode [1-3]: ')
				if (startChoice === '1') await runStartForeground()
				else if (startChoice === '2') await runStartBackground()
				break
			}
			case '4': {
				await runStop()
				break
			}
			case '5': {
				console.log('\nReset Options:')
				console.log('  1. Light: Delete auth, cache, and temp folders (session files)')
				console.log('  2. Strong: Delete session keys and credentials from database')
				console.log('  3. Back')
				const resetChoice = prompt('\nChoose reset type [1-3]: ')
				if (resetChoice === '1') await runResetLight()
				else if (resetChoice === '2') await runResetStrong()
				break
			}
			case '6': {
				exit = true
				break
			}
			default: {
				console.log('Invalid option. Please choose a number from 1 to 6.')
			}
		}
	}

	console.log('\nGoodbye!')
}
