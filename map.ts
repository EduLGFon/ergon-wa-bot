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
	isVisualNonSticker,
	mediaTypes,
	textTypes,
	visualTypes,
} from './conf/types/msgs.js'
import type { CmdCtx, GroupMsg, MediaMsg, Msg, MsgTypes } from './conf/types/types.js'

export {
	allMsgTypes,
	CmdCtx,
	coolTypes,
	coolValues,
	GroupMsg,
	isMedia,
	isVisual,
	isVisualNonSticker,
	MediaMsg,
	mediaTypes,
	Msg,
	MsgTypes,
	textTypes,
	visualTypes,
}

// Config files
import defaults from './conf/defaults.json' with { type: 'json' }
import emojis from './util/emojis.js'

export { defaults, emojis }

// Classes
import Collection from './class/collection.js'
import prisma from './plugin/prisma.js'
import Group from './class/group.js'
import User from './class/user.js'
import Cmd from './class/cmd.js'

export { Cmd, Collection, Group, prisma, User }

// Functions
import { checkPermissions, getCtx, msgMeta } from './util/message.js'
import {
	cacheAllGroups,
	cleanTemp,
	delay,
	findKey,
	genRandomName,
	isEmpty,
	isValidPositiveIntenger,
	makeTempFile,
} from './util/functions.js'
import locale, { languages } from './util/locale.js'
import CacheManager from './plugin/cache.js'
import runCode from './plugin/runCode.js'
import proto from './util/proto.js'

export {
	cacheAllGroups,
	CacheManager,
	checkPermissions,
	cleanTemp,
	delay,
	findKey,
	genRandomName,
	getCtx,
	isEmpty,
	isValidPositiveIntenger,
	languages,
	locale,
	makeTempFile,
	msgMeta,
	proto,
	runCode,
}
