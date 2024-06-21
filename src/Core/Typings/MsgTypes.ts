import type { MsgTypes } from './types.js';

const textMsgs = {
	'conversation': 'text',
	'extendedTextMessage': 'text',
	'editedMessage': 'text',
};

const mediaMsgs = {
	'imageMessage': 'image',
	'stickerMessage': 'sticker',
	'videoMessage': 'video',
	'contactMessage': 'contact',
	'documentMessage': 'document',
	'audioMessage': 'audio',
};

const visualMsgs = {
	'imageMessage': 'image',
	'stickerMessage': 'sticker',
	'videoMessage': 'video',
};

const coolMsgTypes = {
	...textMsgs,
	...mediaMsgs,
	'locationMessage': 'location',
};

const msgTypes = { // all msg types
	...coolMsgTypes,
	'reactionMessage': 'reaction',
	'pinInChatMessage': 'pin',
	'protocolMessage': 'protocol', // Delete msgs

	// API Bots
	'buttonsMessage': 'button',
	'templateMessage': 'template',
	'buttonsResponseMessage': 'buttonReply',
	'templateButtonReplyMessage': 'buttonReply',

	// Polls
	'pollCreationMessageV3': 'poll',
	'pollUpdateMessage': 'pollUpdate',
	
}

const isMedia = (type: MsgTypes) => Object.values(visualMsgs).includes(type);

export { coolMsgTypes, isMedia, mediaMsgs, msgTypes, textMsgs, visualMsgs };
