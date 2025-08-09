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
} from './conf/types/msgs.js'
import type { CmdCtx, GroupMsg, Msg, MsgTypes } from './conf/types/types.js'

export {
	allMsgTypes,
	type CmdCtx,
	coolTypes,
	coolValues,
	type GroupMsg,
	isMedia,
	isVisual,
	mediaTypes,
	type Msg,
	type MsgTypes,
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
import { getCtx, msgMeta } from './util/message.js'
import { delay, findKey, isEmpty, isValidPositiveIntenger } from './util/functions.js'
import locale, { languages } from './util/locale.js'
import CacheManager from './plugin/cache.js'
import runCode from './plugin/runCode.js'
import proto from './util/proto.js'

export {
	CacheManager,
	delay,
	findKey,
	getCtx,
	isEmpty,
	isValidPositiveIntenger,
	languages,
	locale,
	msgMeta,
	proto,
	runCode,
}
