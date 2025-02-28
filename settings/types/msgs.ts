import type { MsgTypes } from './types.js'

const textTypes = {
	'conversation': 'text',
	'editedMessage': 'text',
	'extendedTextMessage': 'text',
}

const visualNonStickerTypes = {
	'ptvMessage': 'video',
	'videoMessage': 'video',
	'imageMessage': 'image',
	'viewOnceMessageV2': 'image',
}

const visualTypes = {
	...visualNonStickerTypes,
	'stickerMessage': 'sticker',
}

const mediaTypes = {
	...visualTypes,
	'audioMessage': 'audio',
	'documentMessage': 'document',
}

const coolTypes = { // Theses will be counted by group msgs counter
	...textTypes,
	...mediaTypes,
	'contactMessage': 'contact',
	'locationMessage': 'location',
	'liveLocationMessage': 'location',
}

const allMsgTypes = { // all msg types
	...coolTypes,
	'call': 'call', // contains only callKey
	'callLogMesssage': 'callLog', // when a call ends
	'reactionMessage': 'reaction',
	'pinInChatMessage': 'pin',
	'eventMessage': 'event', // group events
	'protocolMessage': 'protocol', // delete msgs

	// API Bots
	'buttonsMessage': 'button',
	'templateMessage': 'template',
	'buttonsResponseMessage': 'buttonReply',
	'templateButtonReplyMessage': 'buttonReply',

	// Polls
	'pollCreationMessage': 'poll',
	'pollCreationMessageV3': 'poll',
	'pollUpdateMessage': 'pollUpdate',
}

const visualNonStickerValues = Object.values(visualNonStickerTypes)
const visualValues = Object.values(visualTypes)
const coolValues = Object.values(coolTypes)
const mediaValues = Object.values(mediaTypes)

const isMedia = (type: MsgTypes) => mediaValues.includes(type)
const isVisual = (type: MsgTypes) => visualValues.includes(type)
const isVisualNonSticker = (type: MsgTypes) => visualNonStickerValues.includes(type)

export {
	allMsgTypes,
	coolTypes,
	coolValues,
	isMedia,
	isVisual,
	isVisualNonSticker,
	mediaTypes,
	textTypes,
	visualTypes,
}
