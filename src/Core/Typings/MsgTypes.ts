import type { MsgTypes } from './types.js';

const textMsgs = {
	'conversation': 'text',
	'editedMessage': 'text',
	'extendedTextMessage': 'text',
};

const visualMsgs = {
	'ptvMessage': 'video',
	'videoMessage': 'video',
	'imageMessage': 'image',
	'stickerMessage': 'sticker',
};

const mediaMsgs = {
	...visualMsgs,
	'audioMessage': 'audio',
	'contactMessage': 'contact',
	'documentMessage': 'document',
};


const coolMsgTypes = { // Theses will be counted by group msgs counter
	...textMsgs,
	...mediaMsgs,
	'locationMessage': 'location',
	'liveLocationMessage': 'location'
};

const msgTypes = { // all msg types
	...coolMsgTypes,
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

const isMedia = (type: MsgTypes) => Object.values(visualMsgs).includes(type);

export { coolMsgTypes, isMedia, mediaMsgs, msgTypes, textMsgs, visualMsgs };
