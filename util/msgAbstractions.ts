// msgAbstractions - Baileys send, react and typing touchpoint
// - wraps sendMsg with media cache lookup and locale templates
import { type CmdCtx, type Msg, type SoundStickerContent } from '@conf/types/types.d.ts'
import { buildAudioStickerMessage } from '@plugin/sticker/audioSticker.ts'
import { downloadMedia, getCtx, getMsgType } from '@util/msgTools.ts'
import { findCachedOriginal } from '@plugin/deletedStore.ts'
import { randomEmoji } from '@util/emojis.ts'
import type { AnyMessageContent } from 'baileys'
import cache from '@plugin/cache.ts'
import emojis from '@util/emojis.ts'
import { getFixedT } from 'i18next'
import User from '@class/user.ts'
import bot from '@plugin/bot.ts'

export { getMedia, reactToMsg, sendMsg, startTyping }

async function getMedia(msg: Msg, startTyping?: Func) {
	const target = msg.media ? msg : msg.quoted

	if (!target || !target.media) return
	print(
		'GETMEDIA',
		'target=' + (target === msg ? 'msg' : 'quoted') + ' type=' + target.type,
		'yellow',
	)
	if (startTyping) await startTyping()

	let media = cache.media.get(target.media.url)
	print('GETMEDIA', 'cacheHit=' + !!media, 'yellow')
	if (media) {
		return {
			target,
			buffer: media.buffer,
			url: target.media.url,
			mime: media.mime,
			length: media.length,
			duration: media.duration,
			type: target.type,
			height: media.height,
			width: media.width,
		}
	}

	// Prefer the original cached message by stanzaId (group/user msgs or
	// deletedStore) so downloadMediaMessage runs against a real key/message
	// instead of the synthetic quoted key with an expired URL.
	let source: any = target
	let sourceTypes: [any, str] = [target.type, getMsgType((target as any).message ?? target)[1]]
	if (!msg.media && target?.key?.id) {
		const original = findCachedOriginal(target.chat ?? msg.chat, target.key.id)
		if (original?.message) {
			source = original
			sourceTypes = [original.type, getMsgType(original.message)[1]]
		}
	}

	const downloaded: any = await downloadMedia(source, sourceTypes, true, true)
	let buffer = downloaded?.buffer
	if (!buffer) {
		media = cache.media.get(target.media.url)
		if (media) buffer = media.buffer
	}
	print('GETMEDIA', 'afterDownload hasBuffer=' + !!buffer, 'yellow')
	if (!buffer) return // failed to download media

	const cached = cache.media.get(target.media.url) ?? cache.media.get(downloaded?.url)
	return {
		target,
		buffer,
		url: downloaded?.url ?? target.media.url,
		mime: cached?.mime ?? downloaded?.mime ?? target.mime ?? '',
		length: cached?.length ?? downloaded?.length ?? buffer.length,
		duration: cached?.duration ?? downloaded?.duration ?? 0,
		type: target.type,
		height: cached?.height ?? downloaded?.height ?? 0,
		width: cached?.width ?? downloaded?.width ?? 0,
	}
}

async function startTyping(this: str) {
	return await bot.sock.sendPresenceUpdate('composing', this)
}

// simple abstraction to send a msg
async function sendMsg(
	this: str,
	text: str | AnyMessageContent | SoundStickerContent,
	opts?: { user?: User; quoted?: Msg },
) {
	let content = text

	if (typeof text === 'string') {
		// it's a string, so it can be a text or a template string

		if (opts?.user) {
			// it's a template string, so we can use user's lang
			const t = getFixedT(opts.user.lang)

			if (text.startsWith('usage.')) {
				// it's a cmd usage
				text = text.replace('usage.', '')

				cache.cmds.get('help')!.run({
					args: [text],
					send: sendMsg.bind(this),
					user: opts?.user,
					t,
				} as CmdCtx)
				// run help cmd to get cmd usage
				return {} as CmdCtx
			}
			// it's not a cmd usage, but it's a template string
			content = { text: t(text) } // get the localized text
		} else content = { text } // default content type
	}

	if (typeof content !== 'string' && 'soundSticker' in content) {
		const jid = !this.includes('@') ? this + '@s.whatsapp.net' : this
		const userJid = bot.sock.user?.id
		if (!userJid) throw new Error('cannot send sound sticker before the socket is ready')

		const full = await buildAudioStickerMessage({
			jid,
			userJid,
			sticker: Buffer.from(content.soundSticker.sticker),
			audio: Buffer.from(content.soundSticker.audio),
			seconds: content.soundSticker.seconds,
			isAnimated: content.soundSticker.isAnimated,
			upload: bot.sock.waUploadToServer,
			quoted: opts?.quoted as any,
		})
		await bot.sock.relayMessage(jid, full.message!, { messageId: full.key.id! })

		// convert raw msg on cmd context
		return await getCtx(full)
	}

	const msg = await bot.sock.sendMessage(
		!this.includes('@') ? this + '@s.whatsapp.net' : this,
		content as AnyMessageContent,
		{ quoted: opts?.quoted },
	)

	// convert raw msg on cmd context
	return await getCtx(msg!)
}

// simple abstraction to react to a msg
async function reactToMsg(this: Msg, emoji: str) {
	const text = emoji === 'random' ? randomEmoji() : (emojis as any)[emoji] || emoji

	await sendMsg.bind(this.chat)({ react: { text, key: this.key } })
}
