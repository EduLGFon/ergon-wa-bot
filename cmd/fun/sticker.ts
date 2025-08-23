import { Cmd, CmdCtx, defaults, isVisual, Msg, runCode } from '../../map.js'
import { readFile, writeFile } from 'node:fs/promises'
import { randomDelay } from '../../util/functions.js'
import { getMedia } from '../../util/messages.js'
import { Sticker } from 'wa-sticker-formatter'
import { now } from '../../util/proto.js'
import cache from '../../plugin/cache.js'

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

		// if there is no media or msg type is not visual
		if (!media || !isVisual(media.target.type)) {
			// this logic will create a sticker for each media sent by
			// the user until a msg is not from them
			const chat = group || cache.users.find((u) => u.lid === msg.chat)!
			const msgs = chat.msgs.reverse().slice(1)
			// Sorts msgs from newest to oldest and ignores the cmd msg

			// Find the index of the first msg that is not from the same author or is not valid
			const invalidIndex = msgs.findIndex((m) =>
				m.author !== msg.author || !isVisual(m.type) || m.type === 'sticker'
			)

			const validMsgs = invalidIndex === -1 ? msgs : msgs.slice(0, invalidIndex)

			if (!validMsgs.length) return send('usage.sticker', user)
			randomDelay(69, 500).then(() => react('random'))

			for (const m of validMsgs) await createSticker(m, this.subCmds)
			return
		}

		randomDelay(69, 500).then(() => react('random'))
		createSticker(media.target, this.subCmds)
		return

		async function createSticker(target: Msg, subCmds: str[]) {
			const media = await getMedia(target)
			let { buffer, mime, duration, length, width, height } = media!
			let quality = 1

			const formats = ['full', 'crop']
			if (args.includes(subCmds[1])) formats.push('rounded')
			if (args.includes(subCmds[2])) formats.push('circle')
			if (args.includes(subCmds[3])) formats.push('default')
			// add other sticker formats

			const msgTypeWays = {
				sticker() {
					send({ image: buffer })
					return
				},
				async image() {
					if (!args.includes(subCmds[0])) return
					// remove image background

					const path = defaults.runner.tempFolder + `/rmsticker_${Date.now()}.webp`
					await writeFile(path, buffer)

					// create temporary file

					// execute python background remover plugin on
					await runCode('py', `${path} ${path}.png`, 'plugin/removeBg.py')
					// a child process

					buffer = await readFile(`${path}.png`) || buffer
					// read new file
					return
				},
				async video() {
					// print('mime', mime)
					// quality = 1 // do not use sharp compression
					// const path = defaults.runner.tempFolder + `sticker_${Date.now()}.mp4`
					// const newPath = `${path}.gif`
					// await writeFile(path, buffer)
					// // create temporary file
					// print(`length: ${Number(length) / 1024}kb`)
					// width = 160

					// // const bitrate = Math.floor((0.49 * 1024 * 1024 * 8) / (duration + 1) / 1000) // calculate bitrate in kbps
					// // print(`video bitrate: ${bitrate}kbps`)
					// // await runCode(
					// 	// 	'zsh',
					// // 	`ffmpeg -i ${path} -c:v libx264 -b:v ${bitrate}k -r 20 -an ${newPath}`,
					// // )
					// await runCode('zsh', `ffmpeg -i ${path} -vf "fps=10,scale=${width}:-1:flags=lanczos,palettegen" ${path}_palette.png`)
					// await runCode('zsh', `ffmpeg -i ${path} -i ${path}_palette.png -filter_complex "fps=10,scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse" ${newPath}`)

					// const newSize = await runCode('zsh', `stat -c %s ${newPath}`)
					// print(`video new size: ${Number(newSize) / 1024}kb`)
					// buffer = await readFile(newPath)
					// return
				},
			}

			if (target.type in msgTypeWays) {
				await msgTypeWays[target.type as keyof typeof msgTypeWays]()
			}
			//  async function writeExif(media: Buf, packname?: str) {
			//   const stringJson = JSON.stringify({
			// 	"sticker-pack-id": randomBytes(32).toString('hex'),
			//     "sticker-pack-name": packname || '',
			//     "sticker-pack-publisher": `=== Ergon Bot ===\n` +
			// 						`[👑] Autor: ${user.name}\n` +
			// 						`[📅] Data: ${now('D')}\n` +
			// 						// `[☃️] Dev: Edu\n` +
			// 						`[❓] Suporte: dsc.gg/ergon`,
			//     "emojis": [""]
			//   });
			//   const exifAttr = Buffer.from('SUkqAAgAAAABAEFXBwAAAAAAFgAAAA==', 'base64');
			//   const jsonBuff = Buffer.from(stringJson, "utf8");
			//   const exif = Buffer.concat([exifAttr, jsonBuff]);
			//   exif.writeUIntLE(jsonBuff.length, 14, 4);

			//   const img = new webpmux.Image();
			//   await img.load(media);
			//   img.exif = exif;
			//   return img.save(null);
			// }

			for (const f of formats) {
				const sticker = await new Sticker(buffer!, {
					author: '', // sticker metadata
					pack: `=== Ergon Bot ===\n` +
						`[👑] Autor: ${user.name}\n` +
						`[📅] Data: ${now('D')}\n` +
						// `[☃️] Dev: Edu\n` +
						`[❓] Suporte: dsc.gg/ergon`,
					type: f,
					quality: Number(args[0]) || quality,
				}).toMessage()

				if (target.type === 'video') send(sticker)
				else randomDelay().then(async () => send(sticker))

				// if (mediaType === 'video') send({ sticker: await writeExif(buffer) })
				// else randomDelay().then(async () => send({ sticker: await writeExif(buffer)}))
			}

			return
		}
	}
}
