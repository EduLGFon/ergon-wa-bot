import { Cmd, CmdCtx, defaults, runCode } from '../../map.js'
import { randomEmoji } from '../../util/emojis.js'
import { AnyMessageContent } from 'baileys'
import { readFileSync } from 'node:fs'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['d'],
			cooldown: 10_000,
		})
	}

	async run({ msg, args, user, startTyping, send }: CmdCtx) {
		const url = msg.text.getUrl() || msg?.quoted?.text?.getUrl()
		if (!url) return send('usage.download', user)

		let type: 'video' | 'audio' = args[0] === 'a' ? 'audio' : 'video'

		const cliArgs = ['--cookies', 'conf/cookies.txt']

		const data = {
			caption: randomEmoji(),
			fileName: `download_${Date.now()}.`,
			mimetype: '',
		}

		if (type === 'video') {
			cliArgs.push('-t mp4')

			data.fileName += 'mp4'
			data.mimetype = 'video/mp4'
		} else {
			cliArgs.push('-t mp3')

			data.fileName += 'mp3'
			data.mimetype = 'audio/mpeg'
		}

		const path = `${defaults.runner.tempFolder}${data.fileName}`
		cliArgs.push(`-o ${path}`)

		try {
			await startTyping()
			await runCode('zsh', `${defaults.runner.ytdlp} ${cliArgs.join(' ')} "${url}"`)

			Object.setPrototypeOf(data, {
				[type]: readFileSync(path)
			})

			//@ts-ignore
			delete data.fileName

			send(data as AnyMessageContent)
		} catch (e: any) {
			send(`Não foi possível baixar o arquivo:\n${e.message}`)
		}
		return
	}
}
