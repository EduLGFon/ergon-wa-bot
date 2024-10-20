import { readFile } from 'fs/promises'
import prisma from '../util/prisma.js'
import { proto, User } from '../map.js'
proto()

// users()
async function users() {
	const file = await readFile('migration/users.json', { encoding: 'utf8' })
	const json: User[] = JSON.parse(file)

	for (const u of json) {
		const id = String(u.id)
		if (u.cmds === 0) continue
		if (id == '6969696969') continue

		console.info(id, u.name, u.cmds)
		await prisma.users.upsert({
			where: { phone: id },
			create: {
				phone: id,
				name: u.name,
				lang: 'pt',
				prefix: '.',
				cmds: u.cmds,
			},
			update: {
				cmds: u.cmds,
			},
		})
	}
}

// msgs()
async function msgs() {
	const file = await readFile('migration/msgs.json', { encoding: 'utf8' })
	const json: { author: str; group: str; count: num }[] = JSON.parse(file)

	for (const m of json) {
		if (m.count === 0) continue
		if (m.author.length > 15) {
			console.log('HIGHERHSJDFD HTHAN 15', m)
			continue
		}
		let author = await prisma.users.findFirst({
			where: { phone: m.author },
		})

		if (!author) {
			console.info('========NOT FOUND:', m.author, m.group, m.count, '===========')
			author = await new User({ phone: m.author }).checkData()
		}

		console.info(m.group, author?.name, m.count)
		await prisma.msgs.upsert({
			where: {
				author_group: {
					author: author?.id,
					group: m.group.split('@')[0],
				},
			},
			create: {
				author: author.id,
				group: m.group.split('@')[0],
				count: m.count,
			},
			update: {
				count: m.count,
			},
		})
	}
}

reminders()
async function reminders() {
	const file = await readFile('migration/reminders.json', { encoding: 'utf8' })
	const json: { author: str; chat: str; msg: str; remindAt: str; isDone: bool; id: num }[] = JSON
		.parse(file)

	for (const m of json) {
		const author = await prisma.users.findUnique({
			where: { phone: m.author },
		})

		if (!author) {
			print('NO AUTHORRR:', m)
			continue
		}

		print(m.msg)
		try {
			await prisma.reminders.create({
				data: {
					author: author.id,
					chat: m.chat,
					msg: m.msg,
					remindAt: m.remindAt,
					isDone: m.isDone === null ? false : m.isDone,
				},
			})
		} catch (e) {
			print('ERRO', m)
		}
	}
}
