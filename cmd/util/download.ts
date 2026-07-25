import defaults from '@conf/defaults.json' with { type: 'json' }
import { type CmdCtx } from '@conf/types/types.d.ts'
import type { AnyMessageContent } from 'baileys'
import { randomDelay } from '@util/functions.ts'
import runCode from '@plugin/runCode.ts'
// migrated node:fs
import emojis from '@util/emojis.ts'
import Cmd from '@class/cmd.ts'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['d'],
			cooldown: 30_000,
		})
	}

	async run({ msg, args, user, startTyping, send }: CmdCtx) {
		const url = msg.text.getUrl() || msg?.quoted?.text?.getUrl()
		if (!url) return send('usage.download', { user })

		let type: 'video' | 'audio' = args[0] === 'a' ? 'audio' : 'video'

		const cliArgs = ['--cookies', 'conf/gen/cookies.txt', '--remote-components', 'ejs:github']

		const data = {
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

		const path = `${defaults.runner.tempFolder}/${data.fileName}`
		cliArgs.push(`-o ${path}`)

		let output = ''
		try {
			await randomDelay(250, 700)
			await startTyping()
			output = await runCode('bash', `${defaults.runner.ytdlp} ${cliArgs.join(' ')} "${url}"`)

			Object.setPrototypeOf(data, {
				[type]: await Deno.readFile(path),
			})
			;(data as any).fileName = undefined
			delete (data as any).fileName

			await send(data as AnyMessageContent)
			await Deno.remove(path) // cleanup temp file
		} catch (e: any) {
			send(`[${emojis['alert']}] Não foi possível baixar o arquivo:\n${output}`)
		}
	}
}
