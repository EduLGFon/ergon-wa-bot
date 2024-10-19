import type { MsgTypes } from './types.js'

const textTypes = {
	'conversation': 'text',
	'editedMessage': 'text',
	'extendedTextMessage': 'text',
}

const visualTypes = {
	'ptvMessage': 'video',
	'videoMessage': 'video',
	'imageMessage': 'image',
	'stickerMessage': 'sticker',
}

const mediaTypes = {
	...visualTypes,
	'audioMessage': 'audio',
	'contactMessage': 'contact',
	'documentMessage': 'document',
}

const coolTypes = { // Theses will be counted by group msgs counter
	...textTypes,
	...mediaTypes,
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

const visualValues = Object.values(visualTypes)
const isMedia = (type: MsgTypes) => visualValues.includes(type)

export { allMsgTypes, coolTypes, isMedia, mediaTypes, textTypes, visualTypes }
