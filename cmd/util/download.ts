import { AnyMessageContent } from 'baileys'
import { Cmd, CmdCtx, genRandomName, runCode } from '../../map.js'
import { readFileSync } from 'node:fs'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['d'],
		})
	}

	async run({ bot, msg, args, sendUsage }: CmdCtx) {
		let url = msg.text.getUrl()

		if (!url) url = msg?.quoted?.text?.getUrl()
		if (!url) return sendUsage()

		let type: 'video' | 'audio' = 'video'
		if (args[0] === 'a') {
			args.shift()
			type = 'audio'
		}

		const cliArgs = ['--cookies', 'conf/cookies.txt']

		const data: {
			fileName: str
			mimetype: str
			video?: Buffer
			audio?: Buffer
		} = {
			fileName: genRandomName(20, 'ytdlp_', '.'),
			mimetype: '',
		}

		if (type === 'video') {
			cliArgs.push('--recode-video mp4')

			data.fileName += 'mp4'
			data.mimetype = 'video/mp4'
		} else {
			cliArgs.push('-x', '--audio-format mp3')

			data.fileName += 'mp3'
			data.mimetype = 'audio/mpeg'
		}

		const path = `conf/temp/${data.fileName}`
		cliArgs.push(`-o ${path}`)

		try {
			await bot.react(msg, 'loading')

			await runCode('zsh', `conf/venv/bin/yt-dlp ${cliArgs.join(' ')} "${args[0]}"`)

			data[type] = readFileSync(path)

			//@ts-ignore
			delete data.fileName

			await bot.send(msg, data as AnyMessageContent)
			bot.react(msg, 'ok')
		} catch (e: any) {
			await bot.send(msg, `error: ${e?.message || e}`)
		}
		return
	}
}
