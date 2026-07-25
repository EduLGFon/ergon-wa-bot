import defaults from '@conf/defaults.json' with { type: 'json' }
import { type CmdCtx } from '@conf/types/types.d.ts'
import type { AnyMessageContent } from 'baileys'
import { randomDelay } from '@util/functions.ts'
import runCode from '@plugin/runCode.ts'
import emojis from '@util/emojis.ts'
import { Buffer } from 'node:buffer'
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

		const type: 'video' | 'audio' = args[0] === 'a' ? 'audio' : 'video'

		const cliArgs = [
			'--cookies conf/gen/cookies.txt',
			'--remote-components ejs:github',
			'--no-playlist', // don't download whole playlists
			'--geo-bypass', // bypass geo blocks
			'--socket-timeout 15', // prevent hanging
			'--impersonate Chrome', // bypass bot detection using curl-cffi
			'--max-filesize 2G', // WhatsApp document max size is 2GB
			'--no-warnings', // keep the error logs clean
		]

		if (url.includes('youtube.com') || url.includes('youtu.be')) {
			cliArgs.push('--extractor-args "youtube:player_client=android"')
		} else if (url.includes('twitter.com') || url.includes('x.com')) {
			cliArgs.push('--extractor-args "twitter:api=graphql"')
		} else if (url.includes('tiktok.com')) {
			cliArgs.push(
				'--user-agent "Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36"',
			)
		}

		const data = {
			mimetype: '',
		}
		const fileName = `download_${Date.now()}`

		if (type === 'video') {
			cliArgs.push('-f "b[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"')
			cliArgs.push('-S "res:1080,ext:mp4:m4a"') // cap resolution at 1080p
			cliArgs.push('--recode-video mp4') // guarantee mp4 format

			data.mimetype = 'video/mp4'
			cliArgs.push(`-o "${defaults.runner.tempFolder}/${fileName}.mp4"`)
		} else {
			cliArgs.push('-f "ba/bestaudio/best"')
			cliArgs.push('-x --audio-format mp3') // extract audio and convert to mp3

			data.mimetype = 'audio/mpeg'
			cliArgs.push(`-o "${defaults.runner.tempFolder}/${fileName}.mp3"`)
		}

		const path = `${defaults.runner.tempFolder}/${fileName}.${type === 'video' ? 'mp4' : 'mp3'}`

		let output = ''
		try {
			await randomDelay(250, 700)
			await startTyping()
			output = await runCode('bash', `${defaults.runner.ytdlp} ${cliArgs.join(' ')} "${url}"`)

			const stat = await Deno.stat(path).catch(() => null)
			if (!stat) throw new Error('NOT_FOUND')

			const buffer = Buffer.from(await Deno.readFile(path))

			let mediaMessage: AnyMessageContent
			if (stat.size > 256 * 1024 * 1024) {
				// If over 256MB, send as a Document to bypass the strict video/audio limits
				mediaMessage = {
					document: buffer,
					mimetype: data.mimetype,
					fileName: `${fileName}.${type === 'video' ? 'mp4' : 'mp3'}`,
				} as unknown as AnyMessageContent
			} else {
				// Otherwise, send as native playable media
				mediaMessage = {
					[type]: buffer,
					mimetype: data.mimetype,
				} as unknown as AnyMessageContent
			}

			await send(mediaMessage)
			await Deno.remove(path) // cleanup temp file
		} catch (_e: any) {
			const err = _e?.message === 'NOT_FOUND'
				? ''
				: `\n\n*_Erro interno:_* ${_e?.stack || _e?.message || _e}`
			send(`[${emojis['alert']}] Não foi possível baixar o arquivo:\n${output.trim()}${err}`)
		}
	}
}
