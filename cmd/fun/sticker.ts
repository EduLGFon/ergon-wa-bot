// Sticker maker - builds stickers via sticker engine plus rmbg fallback
// Needed for fast media fun without manual editing
import { createStickers, type StickerFormat } from '@plugin/sticker/index.ts'
import defaults from '@conf/defaults.json' with { type: 'json' }
import { extractAudio } from '@plugin/sticker/audio.ts'
import { type CmdCtx } from '@conf/types/types.d.ts'
import { getMedia } from '@util/msgAbstractions.ts'
import { randomDelay } from '@util/functions.ts'
import { isVisual } from '@conf/types/msgs.ts'
import runCode from '@plugin/runCode.ts'
import { now } from '@util/proto.ts'
import cache from '@plugin/cache.ts'
import Cmd from '@class/cmd.ts'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['s', 'sexo'],
			cooldown: 5_000,
			subCmds: ['rmbg', 'rounded', 'circle', 'som'],
		})
	}

	async run({ msg, args, user, group, send, react, t }: CmdCtx) {
		const media = await getMedia(msg)
		const formats = this.parseFormats(args)
		const withSound = args.includes(this.subCmds[3])
		const quality = Number(args[0]) || undefined

		if (withSound && media?.target.type !== 'video') {
			return send({ text: t('sticker.somOnlyVideo') })
		}

		const metadata = {
			pack: `=== Ergon Bot ===\n` +
				`[👑] Author: ${user.name}\n` +
				`[📅] Date: ${now().split(',')[0]}\n` +
				`[❓] Support: dsc.gg/ergon`,
			author: '',
		}

		// ── No usable media → batch-create from recent cached messages ──
		if (!media || !isVisual(media.target.type)) {
			const chat = group ||
				(cache.userByLid.get(msg.chat) ?? cache.users.find((u) => u.lid === msg.chat))!
			const msgs = chat.msgs.reverse().slice(1)

			const firstInvalid = msgs.findIndex(
				(m) => m.author !== msg.author || !isVisual(m.type) || m.type === 'sticker',
			)
			const validMsgs = firstInvalid === -1 ? msgs : msgs.slice(0, firstInvalid)

			if (!validMsgs.length) return send('usage.sticker', { user })
			randomDelay(69, 500).then(() => react('random'))

			for (const m of validMsgs) {
				const cached = await getMedia(m)
				if (!cached) continue
				await this.processAndSend(
					cached.buffer,
					m.type === 'video',
					formats,
					metadata,
					quality,
					send,
					{ withSound: false, durationS: cached.duration ?? 0, t },
				)
			}
			return
		}

		randomDelay(69, 500).then(() => react('random'))

		// ── Sticker received → reveal as plain image ────────────────────
		if (media.target.type === 'sticker') {
			// Baileys send requires Node Buffer - narrow here.
			return send({ image: Buffer.from(media.buffer) })
		}

		// ── Optional: remove background before creating sticker ─────────
		let buffer = media.buffer
		if (args.includes(this.subCmds[0]) && media.target.type === 'image') {
			buffer = await this.removeBg(buffer)
		}

		await this.processAndSend(
			buffer,
			media.target.type === 'video',
			formats,
			metadata,
			quality,
			send,
			{ withSound, durationS: media.duration ?? 0, t },
		)
	}

	// ── helpers ──────────────────────────────────────────────────────────

	/** Determine which sticker formats to generate from user args. */
	private parseFormats(args: str[]): StickerFormat[] {
		const formats: StickerFormat[] = ['full', 'crop']
		if (args.includes(this.subCmds[1])) formats.push('rounded')
		if (args.includes(this.subCmds[2])) formats.push('circle')
		return formats
	}

	/** Create stickers from a buffer and send them one by one. */
	private async processAndSend(
		buffer: Uint8Array,
		isVideo: boolean,
		formats: StickerFormat[],
		metadata: { pack: string; author: string },
		quality: number | undefined,
		send: CmdCtx['send'],
		opts: { withSound: boolean; durationS: number; t: CmdCtx['t'] },
	): Promise<void> {
		// Sticker engine (sharp/webpmux) requires Node Buffer - narrow here.
		const stickers = await createStickers({
			buffer: Buffer.from(buffer),
			isVideo,
			formats,
			metadata,
			quality,
		})

		// Sound stickers embed one audio track for every generated format.
		let audio: Buffer | null = null
		let seconds = 0
		if (opts.withSound && isVideo) {
			audio = await extractAudio(buffer, {
				tempDir: defaults.runner.tempFolder,
				maxSeconds: 5,
			})
			if (audio) {
				seconds = Math.min(5, Math.max(1, Math.round(opts.durationS || 5)))
			} else {
				await send({ text: opts.t('sticker.somNoAudio') })
			}
		}

		for (const s of stickers) {
			if (!isVideo) await randomDelay(1_000, 2_500)
			if (audio) {
				await send({
					soundSticker: {
						sticker: s.buffer,
						audio,
						seconds,
						isAnimated: isVideo,
					},
				})
			} else {
				await send({ sticker: s.buffer })
			}
		}
	}

	/** Remove image background using the Python rembg plugin. */
	private async removeBg(buffer: Uint8Array): Promise<Uint8Array> {
		const path = `${defaults.runner.tempFolder}/rmsticker_${Date.now()}.webp`
		await Deno.writeFile(path, buffer)
		await runCode('py', `${path} ${path}.png`, 'plugin/removeBg.py')

		const result = await Deno.readFile(`${path}.png`).catch(() => buffer)
		await Deno.remove(path).catch(() => {})
		await Deno.remove(`${path}.png`).catch(() => {})
		return result
	}
}
