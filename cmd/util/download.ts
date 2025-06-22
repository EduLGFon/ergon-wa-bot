import { AnyMessageContent } from 'baileys'
import { Cmd, CmdCtx, runCode } from '../../map.js'
import { readFileSync } from 'node:fs'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['d'],
			cooldown: 10_000,
		})
	}

	async run({ msg, args, react, send }: CmdCtx) {
		let url = msg.text.getUrl()

		if (!url) url = msg?.quoted?.text?.getUrl()
		if (!url) return send('usage.download')

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
			fileName: `yt_dlp_${Date.now()}.`,
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

		const path = `conf/temp/${data.fileName}`
		cliArgs.push(`-o ${path}`)

		try {
			await react('loading')

			await runCode('zsh', `conf/venv/bin/yt-dlp ${cliArgs.join(' ')} "${args[0]}"`)

			data[type] = readFileSync(path)

			//@ts-ignore
			delete data.fileName

			await send(data as AnyMessageContent)
			react('ok')
		} catch (e: any) {
			await send(`error: ${e?.message || e}`)
		}
		return
	}
}
