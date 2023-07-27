import makeWASocket, { PHONENUMBER_MCC } from 'baileys';
//@ts-ignore
import parsePhoneNumber from 'libphonenumber-js';
import readline from 'readline';

export default async function (sock: ReturnType<typeof makeWASocket>) {
	if (!sock.authState.creds.registered) {
		const question = (text: string) => new Promise<string>((r) => rl.question(text, r));

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
			let code = await question('Registration code method: "sms"/"voice" ');
			code = code.replace(/["']/g, '').trim().toLowerCase();

			if (code !== 'sms' && code !== 'voice') return askForOTP();

			r.method = code;

			try {
				await sock.requestRegistrationCode(r);
				await enterCode();
			} catch (error) {
				console.error('Error:\n', error);
				askForOTP();
			}
		}

		async function enterCode() {
			try {
				const code = await question('Insert your registration code:\n');
				const response = await sock.register(
					code.replace(/["']/g, '').trim().toLowerCase(),
				);
				console.log('Registred');
				console.log(response);
				rl.close();
			} catch (error) {
				console.error('Error.\n', error);
				await askForOTP();
			}
		}
	}
}
