import { MsgTypes } from '../Typings';

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

const msgTypes = {
	...textMsgs,
	...mediaMsgs,
	'protocolMessage': 'protocol',
	'reactionMessage': 'reaction',
	'locationMessage': 'location',
};

const visualMsgs = {
	'imageMessage': 'image',
	'stickerMessage': 'sticker',
	'videoMessage': 'video',
};

const isMedia = (type: MsgTypes) => Object.values(visualMsgs).includes(type);

export { isMedia, mediaMsgs, msgTypes, textMsgs, visualMsgs };
