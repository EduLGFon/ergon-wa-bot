/** Import map:
 * This file is an import map
 * It imports all functions and then exports them
 * to all other files
 */

// Types
import {
	allMsgTypes,
	coolTypes,
	coolValues,
	isMedia,
	isVisual,
	mediaTypes,
	textTypes,
	visualTypes,
} from './settings/types/msgs.js'
import type {
	aiPrompt,
	CmdCtx,
	GroupMsg,
	Lang,
	Logger,
	Msg,
	MsgTypes,
} from './settings/types/types.js'

export {
	aiPrompt,
	allMsgTypes,
	CmdCtx,
	coolTypes,
	coolValues,
	GroupMsg,
	isMedia,
	isVisual,
	Lang,
	Logger,
	mediaTypes,
	Msg,
	MsgTypes,
	textTypes,
	visualTypes,
}

// Config files
import settings from './settings/settings.json' with { type: 'json' }
import emojis from './util/emojis.js'
const { bot, db, runner, sticker, api } = settings

export { api, bot, db, emojis, runner, sticker }

// Classes
import Collection from './class/collection.js'
import { server } from './class/server.js'
import Baileys from './class/baileys.js'
import prisma from './util/prisma.js'
import Group from './class/group.js'
import User from './class/user.js'
import Cmd from './class/cmd.js'

export { Baileys, Cmd, Collection, Group, prisma, server, User }

// Functions
import {
	checkPermissions,
	getCtx,
	getMsgText,
	getMsgType,
	getQuoted,
	msgMeta,
} from './util/message.js'
import {
	cacheAllGroups,
	cleanTemp,
	delay,
	findKey,
	genRandomName,
	genStickerMeta,
	isEmpty,
	isValidPositiveIntenger,
	makeTempFile,
} from './util/functions.js'
import proto from './util/proto.js'
import locale, { languages } from './util/locale.js'
import { gemini, imgRemover, runCode } from './util/api.js'

export {
	cacheAllGroups,
	checkPermissions,
	cleanTemp,
	delay,
	findKey,
	gemini,
	genRandomName,
	genStickerMeta,
	getCtx,
	getMsgText,
	getMsgType,
	getQuoted,
	imgRemover,
	isEmpty,
	isValidPositiveIntenger,
	languages,
	locale,
	makeTempFile,
	msgMeta,
	proto,
	runCode,
}
