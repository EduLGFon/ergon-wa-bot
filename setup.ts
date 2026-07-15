import { spawn, spawnSync } from 'node:child_process';
import readline from 'readline/promises';
import path from 'node:path';
import fs from 'node:fs';
import os from 'os';

const isWin = os.platform() === 'win32';

// Helper to run commands cross-platform without using shell: true (avoids DEP0190 deprecation warning)
function runCmd(command: string, args: string[], env: Record<string, string> = {}): boolean {
	let execCmd = command;
	if (isWin) {
		if (command === 'npm') execCmd = 'npm.cmd';
		else if (command === 'npx') execCmd = 'npx.cmd';
	}
	console.log(`\n> Running: ${execCmd} ${args.join(' ')}`);
	const result = spawnSync(execCmd, args, {
		stdio: 'inherit',
		env: { ...process.env, ...env }
	});
	return result.status === 0;
}

// Helper to get python command name without shell: true
function getPythonCommand(): string {
	const testCmd = isWin ? 'python' : 'python3';
	const testPy = spawnSync(testCmd, ['--version']);
	if (testPy.status === 0) return testCmd;
	
	if (!isWin) {
		const testPyNo3 = spawnSync('python', ['--version']);
		if (testPyNo3.status === 0) return 'python';
	}
	
	throw new Error('Python is not installed or not in PATH.');
}

// Manual environment loader
function loadEnv() {
	const envPath = path.join('conf', '.env');

	if (fs.existsSync(envPath)) {
		const content = fs.readFileSync(envPath, 'utf-8');

		for (const line of content.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;
			const index = trimmed.indexOf('=');
			if (index > 0) {
				const key = trimmed.substring(0, index).trim();
				let val = trimmed.substring(index + 1).trim();
				if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
					val = val.substring(1, val.length - 1);
				}
				process.env[key] = val;
			}
		}
	}
}

// 1. Setup options
async function runLightSetup() {
	console.log('\n--- Running Light Setup ---');
	console.log('Installing global tools (prisma, pm2) with scripts allowed...');
	runCmd('npm', ['run', 'presetup']);
	
	console.log('Installing project dependencies...');
	const npmInstalled = runCmd('npm', ['install']);
	if (!npmInstalled) {
		console.error('npm install failed.');
		return false;
	}
	
	console.log('Generating Prisma Client...');
	runCmd('npm', ['run', 'db:gen']);
	console.log('Light Setup completed.');
	return true;
}

async function runMediumSetup() {
	const lightSuccess = await runLightSetup();
	if (!lightSuccess) return false;
	
	console.log('\n--- Running Medium Setup (Python plugins) ---');
	try {
		const pythonCmd = getPythonCommand();
		const venvPath = path.join('conf', 'gen', 'python');
		console.log(`Creating virtual environment with: ${pythonCmd}...`);
		const venvCreated = runCmd(pythonCmd, ['-m', 'venv', venvPath]);
		if (!venvCreated) {
			console.error('Failed to create Python virtual environment.');
			return false;
		}
		
		const pipPath = isWin
			? path.join(venvPath, 'Scripts', 'pip')
			: path.join(venvPath, 'bin', 'pip');
			
		console.log('Installing pip dependencies (rembg, onnxruntime, yt-dlp)...');
		runCmd(pipPath, ['install', 'rembg', 'onnxruntime', 'yt-dlp[default,curl-cffi]']);
		console.log('Medium Setup completed.');
		return true;
	} catch (e: any) {
		console.error('Medium Setup failed:', e.message);
		return false;
	}
}

async function runStrongSetup() {
	const mediumSuccess = await runMediumSetup();
	if (!mediumSuccess) return false;
	
	console.log('\n--- Running Strong Setup (Database) ---');
	console.log('Pushing database schema...');
	const dbPushed = runCmd('npx', ['prisma', 'db', 'push', '--schema=conf/gen/schema.prisma']);
	if (!dbPushed) {
		console.warn('Database schema push failed. Make sure DATABASE_URL in conf/.env is valid and the database server is running.');
		return false;
	}
	console.log('Strong Setup completed.');
	return true;
}

// 2. Configure Environment
async function configureEnv(rl: readline.Interface) {
	console.log('\n=========================================');
	console.log('       Configuration Wizard              ');
	console.log('=========================================');
	
	// Read locale directory to find available languages
	const localesDir = path.join('locale');
	let languages: string[] = ['pt', 'en', 'es', 'fr', 'de'];
	try {
		if (fs.existsSync(localesDir)) {
			const files = fs.readdirSync(localesDir);
			languages = files.filter(f => f.endsWith('.json')).map(f => path.basename(f, '.json'));
		}
	} catch (e) {
		// Keep defaults
	}
	
	// Choose language
	console.log('\nAvailable Bot Languages:');
	languages.forEach((lang, idx) => {
		console.log(`  [${idx + 1}] ${lang}`);
	});
	const langChoice = await rl.question(`Choose language [1-${languages.length}] (default: pt): `);
	const selectedLang = languages[parseInt(langChoice) - 1] || 'pt';
	
	// Choose Prefix
	const prefix = await rl.question('\nEnter Bot Command Prefix (default: .): ') || '.';
	
	// Timezone
	const timezones = ['America/Sao_Paulo', 'UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo'];
	console.log('\nCommon Timezones:');
	timezones.forEach((tz, idx) => {
		console.log(`  [${idx + 1}] ${tz}`);
	});
	console.log(`  [${timezones.length + 1}] Custom Timezone`);
	const tzChoiceInput = await rl.question(`Choose timezone [1-${timezones.length + 1}] (default: America/Sao_Paulo): `);
	let selectedTz = 'America/Sao_Paulo';
	const tzChoice = parseInt(tzChoiceInput);
	if (tzChoice > 0 && tzChoice <= timezones.length) {
		selectedTz = timezones[tzChoice - 1];
	} else if (tzChoice === timezones.length + 1) {
		selectedTz = await rl.question('Enter custom timezone (e.g. Europe/Paris, UTC): ') || 'America/Sao_Paulo';
	}
	
	// Database URL
	const dbUrl = await rl.question('\nEnter Database URL (optional, PostgreSQL recommended. Press enter to skip): ');
	
	// Developers
	const devsInput = await rl.question('\nEnter Developer Phone numbers / LIDs separated by a comma (optional. Press enter to skip): ');
	const selectedDevs = devsInput
		? devsInput.split(',').map(s => s.trim()).filter(Boolean).join('|')
		: '';
		
	// Gemini Key
	const geminiKey = await rl.question('\nEnter Gemini API Key (optional. Press enter to skip. get a key on https://aistudio.google.com/app/apikey): ');
	
	// Ensure conf folder exists
	if (!fs.existsSync('conf')) {
		fs.mkdirSync('conf', { recursive: true });
	}
	
	// Write .env
	const envPath = path.join('conf', '.env');
	const envContent = `# Generated by Ergon WA Bot Setup Wizard
TZ='${selectedTz}'
DEVS='${selectedDevs}'
DATABASE_URL='${dbUrl}'
GEMINI='${geminiKey}'
GROUPS1=''
GROUPS2=''
`;
	fs.writeFileSync(envPath, envContent);
	console.log(`\nWritten configuration to ${envPath}`);
	
	// Write/Update defaults.json
	const defaultsPath = path.join('conf', 'defaults.json');
	let defaults: any = {};
	if (fs.existsSync(defaultsPath)) {
		try {
			defaults = JSON.parse(fs.readFileSync(defaultsPath, 'utf-8'));
		} catch (e) {
			console.warn('Could not parse existing defaults.json. Recreating...');
		}
	}
	
	defaults.lang = selectedLang;
	defaults.prefix = prefix;
	
	// Ensure runner configuration uses correct cross-platform pathing
	if (!defaults.runner) defaults.runner = {};
	if (isWin) {
		defaults.runner.ytdlp = 'conf/gen/python/Scripts/yt-dlp';
		if (!defaults.runner.py) defaults.runner.py = {};
		defaults.runner.py.cmd = ['conf/gen/python/Scripts/python'];
	} else {
		defaults.runner.ytdlp = 'conf/gen/python/bin/yt-dlp';
		if (!defaults.runner.py) defaults.runner.py = {};
		defaults.runner.py.cmd = ['conf/gen/python/bin/python3'];
	}
	
	fs.writeFileSync(defaultsPath, JSON.stringify(defaults, null, '\t') + '\n');
	console.log(`Updated defaults.json language, prefix, and platform paths.`);
	
	// Load the env variables into the process
	loadEnv();
}

// 3. Update bot
async function runUpdate() {
	console.log('\n--- Running Update ---');
	console.log('Pulling latest code changes...');
	const gitPulled = runCmd('git', ['pull', 'origin', 'master']);
	if (!gitPulled) {
		console.warn('Git pull failed. You might have uncommitted changes or no internet access. Continuing update...');
	}
	
	console.log('Updating project dependencies...');
	const npmInstalled = runCmd('npm', ['install']);
	if (!npmInstalled) {
		console.error('npm install failed.');
		return;
	}
	
	console.log('Re-generating Prisma Client...');
	runCmd('npx', ['prisma', 'generate', '--schema=conf/gen/schema.prisma']);
	
	// Update Python dependencies if virtualenv exists
	const pipPath = isWin
		? path.join('conf', 'gen', 'python', 'Scripts', 'pip')
		: path.join('conf', 'gen', 'python', 'bin', 'pip');
		
	if (fs.existsSync(pipPath) || fs.existsSync(pipPath + '.exe')) {
		console.log('Updating Python dependencies...');
		runCmd(pipPath, ['install', '-U', 'rembg', 'onnxruntime', 'yt-dlp[default,curl-cffi]']);
	}
	
	console.log('\nUpdate completed successfully!');
}

// 4. Start/Restart bot
async function runStartForeground() {
	console.log('\n=========================================');
	console.log('     Starting Bot in Foreground          ');
	console.log('=========================================');
	console.log('Press Ctrl+C or close the terminal to terminate the bot process.');
	
	const envExtra = {
		NODE_EXTRA_CA_CERTS: 'conf/smufesrootca.pem'
	};
	
	const child = spawn('node', ['--env-file=conf/.env', 'wa.ts'], {
		stdio: 'inherit',
		env: { ...process.env, ...envExtra }
	});
	
	return new Promise<void>((resolve) => {
		child.on('close', (code) => {
			console.log(`\nBot process exited with code ${code}`);
			resolve();
		});
	});
}

async function runStartBackground() {
	console.log('\n--- Starting in Background (PM2) ---');
	// Check if process wa is already in PM2 list
	const pm2Cmd = isWin ? 'npx.cmd' : 'npx';
	const checkPM2 = spawnSync(pm2Cmd, ['pm2', 'describe', 'wa']);
	if (checkPM2.status === 0) {
		console.log('Bot is already running in PM2. Restarting it...');
		runCmd('npx', ['pm2', 'restart', 'wa']);
	} else {
		console.log('Starting bot with PM2 ecosystem config...');
		runCmd('npx', ['pm2', 'start', 'conf/ecosystem.config.cjs']);
	}
	console.log('Background process launched. Run PM2 stop to terminate.');
}

// 5. Stop bot
async function runStop() {
	console.log('\n--- Stopping PM2 Process ---');
	runCmd('npx', ['pm2', 'delete', 'wa']);
	console.log('Bot process stopped/deleted from PM2.');
}

// 6. Reset folders & database
function cleanFolderContents(dirPath: string) {
	if (fs.existsSync(dirPath)) {
		try {
			const files = fs.readdirSync(dirPath);
			for (const file of files) {
				const fullPath = path.join(dirPath, file);
				fs.rmSync(fullPath, { recursive: true, force: true });
			}
			console.log(`  Cleaned: ${dirPath}`);
		} catch (e: any) {
			console.error(`  Failed to clean ${dirPath}:`, e.message);
		}
	} else {
		fs.mkdirSync(dirPath, { recursive: true });
		console.log(`  Created: ${dirPath}`);
	}
}

async function runResetLight() {
	console.log('\n--- Cleaning Temporary and Auth folders ---');
	cleanFolderContents(path.join('conf', 'gen', 'auth'));
	cleanFolderContents(path.join('conf', 'gen', 'cache'));
	cleanFolderContents(path.join('conf', 'gen', 'temp'));
	console.log('Light Reset completed successfully.');
}

async function runResetStrong() {
	console.log('\n--- Database Truncation (Strong Reset) ---');
	console.log('Loading database configuration...');
	
	// Load the env file into process.env if needed
	loadEnv();
	
	if (!process.env.DATABASE_URL) {
		console.error('Error: DATABASE_URL is not set in conf/.env. Cannot truncate database.');
		return;
	}
	try {
		console.log('Loading Prisma Client...');
		// Import generated client
		const { PrismaClient } = await import('./conf/gen/prisma/client.ts');
		let prisma: any;

		try {
			const { PrismaPg } = await import('@prisma/adapter-pg');
			const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
			prisma = new PrismaClient({ adapter });
		} catch (e) {
			//@ts-ignore Fallback to standard PrismaClient
			prisma = new PrismaClient();
		}
		
		console.log('Connecting to database...');
		await prisma.$connect();

		console.log('Truncating key and credential tables...');
		const keyResult = await prisma.authKey.deleteMany()
			.catch((e: any) => ({ count: 0, error: e }));

		if ('error' in keyResult && keyResult.error) {
			console.warn('  Warning: Could not delete authKeys:', keyResult.error.message || keyResult.error);
		} else console.log(`  Deleted ${keyResult.count} auth keys.`);
		
		const credsResult = await prisma.authCreds.deleteMany()
			.catch((e: any) => ({ count: 0, error: e }));
		if ('error' in credsResult && credsResult.error) {
			console.warn('  Warning: Could not delete authCreds:', credsResult.error.message || credsResult.error);
		} else console.log(`  Deleted ${credsResult.count} credentials.`);
		
		await prisma.$disconnect();
		console.log('Strong Reset completed.');
	} catch (e: any) {
		console.error('Failed to execute database truncation:', e.message || e);
	}
}

// MAIN WIZARD LOOP
async function main() {
	loadEnv();
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	
	// If .env doesn't exist, force configuration first
	if (!fs.existsSync(path.join('conf', '.env'))) {
		console.log('\nWelcome! No configuration file (.env) was found.');
		console.log('Launching Configuration Wizard first...');
		await configureEnv(rl);
	}
	
	let exit = false;
	while (!exit) {
		console.log('\n=========================================');
		console.log('      Ergon WA Bot Setup & Manager      ');
		console.log('=========================================');
		console.log('1. Setup (Install dependencies & environment)');
		console.log('2. Update (Pull code changes and update packages)');
		console.log('3. Start / Restart');
		console.log('4. Stop');
		console.log('5. Reset (Delete local session data or database keys)');
		console.log('6. Exit');
		
		const choice = await rl.question('\nSelect an option [1-6]: ');
		
		switch (choice.trim()) {
			case '1': {
				console.log('\nSetup Options:');
				console.log('  1. Light: Minimum packages to run (npm install only)');
				console.log('  2. Medium: Light setup + Python dependencies (Background removal & Video download)');
				console.log('  3. Strong: Medium setup + Database migration (Prisma push)');
				console.log('  4. Re-configure Environment (.env and defaults.json)');
				console.log('  5. Back');
				const setupChoice = await rl.question('\nChoose setup level [1-5]: ');
				if (setupChoice === '1') await runLightSetup();
				else if (setupChoice === '2') await runMediumSetup();
				else if (setupChoice === '3') await runStrongSetup();
				else if (setupChoice === '4') await configureEnv(rl);
				break;
			}
			case '2': {
				await runUpdate();
				break;
			}
			case '3': {
				console.log('\nProcess Management:');
				console.log('  1. Start in Foreground (Active interactive shell)');
				console.log('  2. Start in Background (PM2 process runner)');
				console.log('  3. Back');
				const startChoice = await rl.question('\nChoose run mode [1-3]: ');
				if (startChoice === '1') await runStartForeground();
				else if (startChoice === '2') await runStartBackground();
				break;
			}
			case '4': {
				await runStop();
				break;
			}
			case '5': {
				console.log('\nReset Options:');
				console.log('  1. Light: Delete auth, cache, and temp folders (session files)');
				console.log('  2. Strong: Delete session keys & credentials from database');
				console.log('  3. Back');
				const resetChoice = await rl.question('\nChoose reset type [1-3]: ');
				if (resetChoice === '1') await runResetLight();
				else if (resetChoice === '2') await runResetStrong();
				break;
			}
			case '6': {
				exit = true;
				break;
			}
			default: {
				console.log('Invalid option. Please choose a number from 1 to 6.');
			}
		}
	}
	
	rl.close();
	console.log('\nGoodbye!');
}

main().catch(err => {
	console.error('Fatal error in wizard:', err);
	process.exit(1);
});
