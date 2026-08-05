import defaults from '@conf/defaults.json' with { type: 'json' }
import { type CmdCtx } from '@conf/types/types.d.ts'
import type { AnyMessageContent } from 'baileys'
import { randomDelay } from '@util/functions.ts'
import emojis from '@util/emojis.ts'
import { Buffer } from 'node:buffer'
import Cmd from '@class/cmd.ts'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['d'],
			cooldown: 10_000,
		})
	}

	async run({ msg, args, user, react, send }: CmdCtx) {
		const urls = msg.text.getUrl() || msg?.quoted?.text?.getUrl()
		const url = urls?.[0]
		if (!url) return send('usage.download', { user })

		const type: 'video' | 'audio' = args[0] === 'a' ? 'audio' : 'video'

		const cliArgs = [
			'--cookies',
			'conf/gen/cookies.txt',
			'--remote-components',
			'ejs:github',
			'--no-playlist', // don't download whole playlists
			'--geo-bypass', // bypass geo blocks
			'--socket-timeout',
			'25', // prevent hanging
			'--impersonate',
			'Chrome', // bypass bot detection using curl-cffi
			'--max-filesize',
			'2G', // WhatsApp document max size is 2GB
			'--no-warnings', // keep the error logs clean
			'-N',
			'16', // concurrent fragment downloads for HLS/DASH streams (Reddit/Twitch/etc)
			'--retries',
			'10', // retry on network errors
			'--fragment-retries',
			'10', // retry on fragment download errors
			'--retry-sleep',
			'linear=1:5:1',
			'--force-ipv4',
			'--postprocessor-args',
			'ffmpeg:-movflags +faststart',
		]

		if (url.includes('twitter.com') || url.includes('x.com')) {
			cliArgs.push('--extractor-args', 'twitter:api=graphql')
		}

		const fileName = `download_${Date.now()}`
		const path = `${defaults.runner.tempFolder}/${fileName}.${type === 'video' ? 'mp4' : 'mp3'}`

		const data = {
			mimetype: '',
		}

		if (type === 'video') {
			cliArgs.push('-f', 'bv*[vcodec^=avc]+ba[acodec^=aac]/b[ext=mp4]/best')
			cliArgs.push('-S', 'res:1080,codec:h264:aac,ext:mp4:m4a')
			cliArgs.push('--remux-video', 'mp4')
			cliArgs.push('--merge-output-format', 'mp4')
			cliArgs.push('-o', path)
			data.mimetype = 'video/mp4'
		} else {
			cliArgs.push('-f', 'bestaudio')
			cliArgs.push('-x', '--audio-format', 'mp3', '--audio-quality', '0') // highest VBR
			cliArgs.push('-o', path)
			data.mimetype = 'audio/mpeg'
		}

		cliArgs.push(url)

		let output = ''
		try {
			await randomDelay(250, 1_000)
			await react('loading') // indicate that the download is in progress

			const cmdObj = new Deno.Command(defaults.runner.ytdlp, { args: cliArgs })
			const { stdout, stderr } = await cmdObj.output()
			output = new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr)

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
