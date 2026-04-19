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
} from './conf/types/msgs.ts'
import type { CmdCtx, GroupMsg, Msg, MsgTypes } from './conf/types/types.ts'

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
import emojis from './util/emojis.ts'

export { defaults, emojis }

// Classes
import Collection from './class/collection.ts'
import prisma from './plugin/prisma.ts'
import Group from './class/group.ts'
import User from './class/user.ts'
import Cmd from './class/cmd.ts'

export { Cmd, Collection, Group, prisma, User }

// Functions
import { delay, findKey, isEmpty, isValidPositiveIntenger } from './util/functions.ts'
import { getCtx, msgMeta } from './util/message.ts'
import CacheManager from './plugin/cache.ts'
import runCode from './plugin/runCode.ts'
import locale from './util/locale.ts'
import proto from './util/proto.ts'

export {
	CacheManager,
	delay,
	findKey,
	getCtx,
	isEmpty,
	isValidPositiveIntenger,
	locale,
	msgMeta,
	proto,
	runCode,
}
