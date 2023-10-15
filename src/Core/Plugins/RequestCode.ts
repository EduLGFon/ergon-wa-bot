import { PHONENUMBER_MCC, type WASocket } from 'baileys';
import parsePhoneNumber from 'libphonenumber-js';
import readline from 'readline';

export default async function (sock: WASocket) {
	if (!sock.authState.creds.registered) {
		const question = (text: str) => new Promise<str>((r) => rl.question(text, r));

		const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
		const { registration: r } = sock.authState.creds || { registration: {} };

		if (!r.phoneNumber) r.phoneNumber = await question('Insert your phone number: ');

		const phoneNumber = parsePhoneNumber(r.phoneNumber);

		if (!phoneNumber?.isValid()) throw new Error(`Invalid phone number`);

		r.phoneNumber = phoneNumber.format('E.164');
		r.phoneNumberCountryCode = phoneNumber.countryCallingCode;
		r.phoneNumberNationalNumber = phoneNumber.nationalNumber;

		//@ts-ignore
		const mcc = PHONENUMBER_MCC[phoneNumber.countryCallingCode];

		if (!mcc) throw new Error('MCC not found.');

		r.phoneNumberMobileCountryCode = mcc;

		askForOTP();

		async function askForOTP() {
			let code = await question('Choose a registration method: "sms"/"voice" ');
			code = code.replace(/["']/g, '').trim().toLowerCase();

			if (code !== 'sms' && code !== 'voice') return askForOTP();

			r.method = code;

			try {
				await sock.requestRegistrationCode(r);
				enterCode();
			} catch (error) {
				console.error('[API', error);
				askForOTP();
			}

			return;
		}

		async function enterCode(): Promise<void> {
			try {
				const code = await question('Insert your registration code:\n');
				const response = await sock.register(
					code.replace(/["']/g, '').trim().toLowerCase(),
				);
				console.log('API', 'Successfully registered', 'green');
				console.log(response);
				rl.close();
			} catch (error) {
				console.error('API', `Failed to register: ${error}`);
				
				askForOTP();
			}

			return;
		}
		return;
	}
}
