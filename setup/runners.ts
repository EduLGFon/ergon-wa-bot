// setup-runners - runCmd and light medium strong setups - Deno-only
// - uses Deno-Command for installs and updates - no npm
import { existsSync } from './env.ts'

export const isWin = Deno.build.os === 'windows'

export function join(...parts: string[]): string {
	return parts.join('/').replace(/\/+/g, '/')
}

// Helper to run commands cross-platform without using shell true - avoids DEP0190 deprecation warning
export function runCmd(command: string, args: string[], env: Record<string, string> = {}): boolean {
	let execCmd = command
	if (isWin) {
		if (command === 'deno') execCmd = 'deno.exe'
		else if (command === 'pm2') execCmd = 'pm2.cmd'
	}
	console.log(`\n> Running: ${execCmd} ${args.join(' ')}`)
	const cmd = new Deno.Command(execCmd, {
		args,
		stdin: 'inherit',
		stdout: 'inherit',
		stderr: 'inherit',
		env: { ...Deno.env.toObject(), ...env },
	})
	const result = cmd.outputSync()
	return result.success
}

// Helper to get python command name without shell true
export function getPythonCommand(): string {
	const testCmd = isWin ? 'python' : 'python3'
	try {
		const testPy = new Deno.Command(testCmd, { args: ['--version'] }).outputSync()
		if (testPy.success) return testCmd
	} catch (_e) { /* noop */ }

	if (!isWin) {
		try {
			const testPyNo3 = new Deno.Command('python', { args: ['--version'] }).outputSync()
			if (testPyNo3.success) return 'python'
		} catch (_e) { /* noop */ }
	}

	throw new Error('Python is not installed or not in PATH.')
}

// 1 - Setup options
export function runLightSetup() {
	console.log('\n--- Running Light Setup ---')
	console.log('Installing global tools (drizzle-kit, pm2) with scripts allowed...')
	runCmd('deno', ['task', 'presetup'])

	console.log('Installing project dependencies...')
	const npmInstalled = runCmd('deno', ['install'])
	if (!npmInstalled) {
		console.error('npm install failed.')
		return false
	}

	console.log('Generating Drizzle schema...')
	runCmd('deno', ['task', 'db:gen'])
	console.log('Light Setup completed.')
	return true
}

export async function runMediumSetup() {
	const lightSuccess = await runLightSetup()
	if (!lightSuccess) return false

	console.log('\n--- Running Medium Setup (Python plugins) ---')
	try {
		const pythonCmd = getPythonCommand()
		const venvPath = join('conf', 'gen', 'python')
		console.log(`Creating virtual environment with: ${pythonCmd}...`)
		const venvCreated = runCmd(pythonCmd, ['-m', 'venv', venvPath])
		if (!venvCreated) {
			console.error('Failed to create Python virtual environment.')
			return false
		}

		const pipPath = isWin ? join(venvPath, 'Scripts', 'pip') : join(venvPath, 'bin', 'pip')

		console.log('Installing pip dependencies (rembg, onnxruntime, yt-dlp)...')
		runCmd(pipPath, ['install', 'rembg', 'onnxruntime', 'yt-dlp[default,curl-cffi]'])
		console.log('Medium Setup completed.')
		return true
	} catch (e: any) {
		console.error('Medium Setup failed:', e.message)
		return false
	}
}

export async function runStrongSetup() {
	const mediumSuccess = await runMediumSetup()
	if (!mediumSuccess) return false

	console.log('\n--- Running Strong Setup (Database) ---')
	console.log('Pushing database schema...')
	const dbPushed = runCmd('deno', ['task', 'db:push'])
	if (!dbPushed) {
		console.warn(
			'Database schema push failed. Make sure DATABASE_URL in conf/.env is valid and the database server is running.',
		)
		return false
	}
	console.log('Strong Setup completed.')
	return true
}

// 2 - Update bot
export function runUpdate() {
	console.log('\n--- Running Update ---')
	console.log('Pulling latest code changes...')
	const gitPulled = runCmd('git', ['pull', 'origin', 'master'])
	if (!gitPulled) {
		console.warn(
			'Git pull failed. You might have uncommitted changes or no internet access. Continuing update...',
		)
	}

	console.log('Updating project dependencies...')
	const npmInstalled = runCmd('deno', ['install'])
	if (!npmInstalled) {
		console.error('npm install failed.')
		return
	}

	console.log('Re-generating Drizzle schema...')
	runCmd('deno', ['task', 'db:gen'])

	// Update Python dependencies if virtualenv exists
	const pipPath = isWin
		? join('conf', 'gen', 'python', 'Scripts', 'pip')
		: join('conf', 'gen', 'python', 'bin', 'pip')

	if (existsSync(pipPath) || existsSync(pipPath + '.exe')) {
		console.log('Updating Python dependencies...')
		runCmd(pipPath, ['install', '-U', 'rembg', 'onnxruntime', 'yt-dlp[default,curl-cffi]'])
	}

	console.log('\nUpdate completed successfully!')
}
