// Remove command - strips image background via Python rembg
// Needed to make clean cutouts with safe original fallback
import defaults from '@conf/defaults.json' with { type: 'json' }
import { type CmdCtx } from '@conf/types/types.d.ts'
import { getMedia } from '@util/msgAbstractions.ts'
import runCode from '@plugin/runCode.ts'
import emojis from '@util/emojis.ts'
import Cmd from '@class/cmd.ts'

export default class extends Cmd {
	constructor() {
		super({
			alias: ['rm'],
			cooldown: 5_000,
		})
	}

	async run({ msg, startTyping, send, t }: CmdCtx) {
		const media = await getMedia(msg)

		if (!media || !media.mime.includes('image')) return send(t('sticker.nobuffer'))
		await startTyping()

		// Unique temp names avoid same-millisecond collisions between concurrent calls.
		await Deno.mkdir(defaults.runner.tempFolder, { recursive: true })
		const path = defaults.runner.tempFolder +
			`/rm_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}.webp`
		const outPath = `${path}.png`
		let buffer: Uint8Array = media.buffer

		try {
			await Deno.writeFile(path, media.buffer)
			// runCode never throws: it returns stdout+stderr as a string even on
			// Python failure (e.g. PIL UnidentifiedImageError on corrupt input).
			// So the output file must be checked explicitly instead of assuming it exists.
			const pyOut = await runCode('py', `${path} ${outPath}`, 'plugin/removeBg.py')
			const outStat = await Deno.stat(outPath).catch(() => null)
			if (!outStat) {
				// Python step failed (unsupported/corrupt image, missing model, OOM, ...).
				// Fall back to the original image instead of throwing ENOENT.
				print(
					'CMD/remove',
					`removeBg produced no output, using original. py: ${
						String(pyOut).slice(0, 500)
					}`,
					'yellow',
				)
			} else {
				buffer = await Deno.readFile(outPath).catch(() => media.buffer)
			}
		} catch (e) {
			// Any FS failure also falls back to the original instead of crashing the handler.
			print(
				'CMD/remove',
				`removeBg temp handling failed, using original: ${(e as Error)?.message || e}`,
				'yellow',
			)
			buffer = media.buffer
		} finally {
			// Always cleanup, even when read/stat failed (previous version leaked on throw).
			await Deno.remove(path).catch(() => {})
			await Deno.remove(outPath).catch(() => {})
		}

		await send({ caption: emojis['sparkles'], image: Buffer.from(buffer) }, { quoted: msg })
	}
}
