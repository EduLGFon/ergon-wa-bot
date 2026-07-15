import { createStickers, type StickerFormat } from '../../plugin/sticker/index.ts'
import { Cmd, type CmdCtx, defaults, isVisual, runCode } from '../../map.ts'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { getMedia } from '../../util/msgAbstractions.ts'
import { randomDelay } from '../../util/functions.ts'
import { now } from '../../util/proto.ts'
import cache from '../../plugin/cache.ts'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['s', 'sexo'],
			cooldown: 5_000,
			subCmds: ['rmbg', 'rounded', 'circle', 'default'],
		})
	}

	async run({ msg, args, user, group, send, react }: CmdCtx) {
		const media = await getMedia(msg)
		const formats = this.parseFormats(args)
		const quality = Number(args[0]) || undefined
		const metadata = {
			pack:
				`=== Ergon Bot ===\n` +
				`[👑] Autor: ${user.name}\n` +
				`[📅] Data: ${now('D')}\n` +
				`[❓] Suporte: dsc.gg/ergon`,
			author: '',
		}

		// ── No usable media → batch-create from recent cached messages ──
		if (!media || !isVisual(media.target.type)) {
			const chat = group || cache.users.find(u => u.lid === msg.chat)!
			const msgs = chat.msgs.reverse().slice(1)

			const firstInvalid = msgs.findIndex(
				m => m.author !== msg.author || !isVisual(m.type) || m.type === 'sticker',
			)
			const validMsgs = firstInvalid === -1 ? msgs : msgs.slice(0, firstInvalid)

			if (!validMsgs.length) return send('usage.sticker', { user })
			randomDelay(69, 500).then(() => react('random'))

			for (const m of validMsgs) {
				const cached = await getMedia(m)
				if (!cached) continue
				await this.processAndSend(
					cached.buffer, m.type === 'video', formats, metadata, quality, send,
				)
			}
			return
		}

		randomDelay(69, 500).then(() => react('random'))

		// ── Sticker received → reveal as plain image ────────────────────
		if (media.target.type === 'sticker') {
			return send({ image: media.buffer })
		}

		// ── Optional: remove background before creating sticker ─────────
		let buffer = media.buffer
		if (args.includes(this.subCmds[0]) && media.target.type === 'image') {
			buffer = await this.removeBg(buffer)
		}

		await this.processAndSend(
			buffer, media.target.type === 'video', formats, metadata, quality, send,
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
		buffer: Buffer,
		isVideo: boolean,
		formats: StickerFormat[],
		metadata: { pack: string; author: string },
		quality: number | undefined,
		send: CmdCtx['send'],
	): Promise<void> {
		const stickers = await createStickers({
			buffer, isVideo, formats, metadata, quality,
		})

		for (const s of stickers) {
			if (!isVideo) await randomDelay(1_000, 2_500)
			await send({ sticker: s.buffer })
		}
	}

	/** Remove image background using the Python rembg plugin. */
	private async removeBg(buffer: Buffer): Promise<Buffer> {
		const path = `${defaults.runner.tempFolder}/rmsticker_${Date.now()}.webp`
		await writeFile(path, buffer)
		await runCode('py', `${path} ${path}.png`, 'plugin/removeBg.py')

		const result = await readFile(`${path}.png`).catch(() => buffer)
		await unlink(path).catch(() => {})
		await unlink(`${path}.png`).catch(() => {})
		return result
	}
}
