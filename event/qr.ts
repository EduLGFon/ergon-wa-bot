import { Client } from 'wa'
import qrcode from 'qr'

// When the client receive the login QR-Code
export default async function (bot: Client, qr: str) {
	console.log('LOGIN', 'QR-Code received', 'green')
	qrcode.generate(qr, { small: true })

	const phone = prompt('Enter your phone number to request pairing code or press Enter to skip: ')
	if (!phone) return console.log('No phone number provided, pairing code will not be requested')

	const code = await bot.requestPairingCode(phone)
	console.log('Pairing code enabled, code: ' + code)
	return
}
