import type { MsgTypes } from './types.js'

const textTypes = {
	conversation: 'text',
	editedMessage: 'text',
	extendedTextMessage: 'text',
}

const visualTypes = {
	ptvMessage: 'video',
	videoMessage: 'video',
	imageMessage: 'image',
	viewOnceMessageV2: 'image',
	stickerMessage: 'sticker',
}

const mediaTypes = {
	...visualTypes,
	audioMessage: 'audio',
	documentMessage: 'document',
}

const coolTypes = {
	// Theses will be counted by group msgs counter
	...textTypes,
	...mediaTypes,
	contactMessage: 'contact',
}

const allMsgTypes = {
	// all msg types
	...coolTypes,
	locationMessage: 'location',
	liveLocationMessage: 'location',
	call: 'call', // contains only callKey
	callLogMesssage: 'callLog', // when a call ends
	reactionMessage: 'reaction',
	pinInChatMessage: 'pin',
	eventMessage: 'event', // group events
	protocolMessage: 'protocol', // delete msgs
	albumMessage: 'album', // contains multiple media msgs

	// API Bots
	buttonsMessage: 'button',
	templateMessage: 'template',
	buttonsResponseMessage: 'buttonReply',
	templateButtonReplyMessage: 'buttonReply',

	// Polls
	pollCreationMessage: 'poll',
	pollCreationMessageV3: 'poll',
	pollUpdateMessage: 'pollUpdate',
}

const visualValues = Object.values(visualTypes)
const coolValues = Object.values(coolTypes)
const mediaValues = Object.values(mediaTypes)

const isMedia = (type: MsgTypes) => mediaValues.includes(type)
const isVisual = (type: MsgTypes) => visualValues.includes(type)

export {
	allMsgTypes,
	coolTypes,
	coolValues,
	isMedia,
	isVisual,
	mediaTypes,
	textTypes,
	visualTypes,
}
