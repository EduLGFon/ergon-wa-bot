# Ergon WA Bot - Architecture

Ergon is a WhatsApp chat bot (Deno + Baileys) with a command framework, Gemini AI chat, a custom
sticker engine, scheduled university bulletins, and a bidirectional WhatsApp-Telegram forum bridge
running in the same process.

Audience note: this file is written for AI coding agents researching the workspace. It maps every
directory, file, data flow, and convention so you can locate code fast.

## 1. Big picture

- One Deno process boots a WhatsApp socket (Baileys), loads commands and event handlers from disk,
  then attaches the Telegram bridge onto the same socket.
- Inbound path: `sock.ev 'messages.upsert'` -> `event/messages/upsert.ts` ->
  `util/msgTools.ts:getCtx` (raw Baileys -> `CmdCtx`) -> `Cmd.checkPerms` ->
  `cmd/<category>/<name>.ts:run(ctx)`.
- Outbound path: all sends go through `util/msgAbstractions.ts` (`sendMsg`, `reactToMsg`,
  `startTyping`) bound per message as `ctx.send` / `ctx.react` / `ctx.startTyping`.
- Bridge path: extra listeners on the shared WA socket relay to one Telegram forum supergroup (one
  topic per WA chat) via grammy, and grammy handlers send back to WA. Pairing state lives in SQLite
  (`conf/gen/bridge.db`).
- Persistence is optional-but-degraded: with `DATABASE_URL` you get Postgres (users, msg counts,
  auth keys); without it the bot runs on file auth (`conf/gen/auth/`) plus in-memory caches.
- Scheduled jobs (Deno.cron): morning RU restaurant bulletin, 15-min menu change checks on weekdays,
  weekly academic-calendar refresh.

## 2. Tech stack

- Runtime: Deno 2.x only. Package deps via `deno.jsonc` import map.
- WhatsApp: `npm:@whiskeysockets/baileys@7.0.0-rc14` (pinned).
- Telegram: `npm:grammy@1.46.0/web` (the `/web` fetch-based adapter, no Node http server; chosen for
  Deno compatibility).
- DB: `drizzle-orm` + `postgres` (postgres-js) + `drizzle-kit` migrations.
- AI: `npm:@google/genai` (Gemini chat + file upload).
- Media: `sharp` (static stickers), system `ffmpeg` (animated stickers), `node-webpmux` (WebP EXIF),
  Python venv (`rembg`, `onnxruntime`, `yt-dlp`).
- i18n: `i18next` with a custom Deno file backend.
- QR render: `jsr:@libs/qrcode`.
- Process: PM2 (`conf/ecosystem.config.cjs`) in prod, `deno task dev` locally.

## 3. Repository map

```
wa.ts                    # prod entry point
setup.ts + setup/        # interactive installer/manager (wizard, env, runners, reset)
bridge/                  # WA<->TG bridge (own deno.jsonc, facades + 2 module dirs)
  bridge/mod.ts          # orchestration: startBridge, reattachBridge, findSupergroupId
  bridge/db.ts           # SQLite pairing + reply map + echo guards
  bridge/format.ts       # TG entities <-> WA markdown converters
  bridge/rate-limiter.ts # FIFO flood gate with 429 retry
  bridge/wa-to-tg.ts     # facade re-exporting wa-to-tg/
  bridge/wa-to-tg/       # 33 modules: relay, state, incoming, dispatch, chat, topics, jid,
                         # routing, move, prompt, text, media, media-utils, send, send-media,
                         # quote, album, album-flush, album-send, edits, deletes, pins, calls,
                         # reactions, reaction-summary, special, polls, poll-tally, rich,
                         # secret-edits, unsupported, unsupported-preview, errors
  bridge/tg-to-wa/       # 9 modules: handlers, handler-events, content, media,
                         # replies, album, commands, buckets, newchat
class/                   # domain models: baileys.ts, cmd.ts, collection.ts,
                         # group.ts, user.ts
cmd/ (18 files)          # commands: config/{help,language,prefix}, dev/{eval,execute,
                         # memory,ping}, fun/{choose,gemini,rank,sticker},
                         # util/{clean,download,everyone,gotcha,remove,reveal,translate}
event/ (6 files)         # Baileys handlers: connection/update,
                         # group-participants/update, groups/update,
                         # messages/upsert, messages/update, messaging-history/set
conf/                    # schema.ts, defaults.json, .env(.example),
                         # ecosystem.config.cjs, bulletinTitles.json,
                         # smufesrootca.pem, types/, gen/
plugin/                  # services: bot, authState, db, cache, deletedStore,
                         # memories, menuScraping, groupAnnouncer, runCode,
                         # calendarParser + calendar/, sticker/, removeBg.py
util/ (14 files)         # handler, proto, locale, msgTools, msgAbstractions,
                         # geminiApi, functions, emojis, weather, menuParser,
                         # calendarAnalytics, bulletinTitles, dailySummary
locale/                  # pt,en,es,fr,de JSON (pt is canonical)
scripts/                 # agent scratch + dev diagnostics (dump_calendar.ts)
```

## 4. Boot and process lifecycle

`wa.ts` order matters: `proto()` (globals) -> `locale()` (i18n) -> `start()` -> `bot.connect()` ->
`loadCmds()` -> `cache.resume()` -> `loadEvents()` -> dynamic
`import('./bridge/mod.ts'):startBridge()` -> `scheduleURMenuMsg()` only if `GROUPS1` is set.

- Crash guards: `unhandledrejection` and `error` listeners call `preventDefault()` and log
  `CRASH ... kept alive`. Rationale: prod showed transient WA 428/503/408 errors and torn fetch
  bodies that must not kill the process. Only an explicit `loggedOut` exits; startup failure
  exits 1.
- Signals: `SIGINT`/`SIGTERM` -> `cache.save()` + `shutdownStickers()` -> `Deno.exit(0)`. PM2
  `kill_timeout: 10s` gives the flush time to finish.
- Reconnect (`event/connection/update.ts`): QR printed to console; `open` logs stabilized; `close`
  checks `DisconnectReason.loggedOut` (exit 0, no retry). Reentrancy guard `isReconnecting`, sliding
  window (3+ reconnects/min -> wait 60s), teardown (`removeAllListeners`, `ws.close`, `end`), random
  1-10s delay, `bot.connect()` with one retry after 15s, then `loadEvents()` + `reattachBridge()`.
- PM2 (`conf/ecosystem.config.cjs`): app `wa`, `interpreter: deno`,
  `--v8-flags=--expose-gc --env=conf/.env`, `autorestart`, `min_uptime: 10s`, exponential backoff,
  `log_file: conf/gen/out.log`.

## 5. Configuration

- `deno.jsonc`: import map (`@class/ @cmd/ @conf/ @event/ @plugin/ @util/ @db
  @wa`, plus npm/jsr
  deps), `unstable: ["cron"]`, fmt (tabs, single quotes, no semicolons, width 100), lint (excludes
  `no-explicit-any`, `no-import-prefix`, `no-unversioned-import`), compiler types
  (`conf/types/global.d.ts`), tasks: `setup`, `setup:medium`, `setup:strong`, `wizard`, `update`,
  `start`, `start:dev`, `restart`, `stop`, `db:gen/push/pull`, `reset`, `check`, `lint`, `fmt`,
  `verify`, `dev`, `translate`.
- `bridge/deno.jsonc`: same style config scoped to the bridge, same dep pins.
- `conf/.env` (see `conf/.env.example`): `TZ`, `DEVS` (owner LIDs, `|` split), `GROUPS1`/`GROUPS2`
  (announcement targets), optional `DATABASE_URL`, `GEMINI`, `TELEGRAM_BOT_TOKEN`,
  `TELEGRAM_SUPERGROUP_PERSONAL`/`_BUSINESS` (legacy `TELEGRAM_SUPERGROUP_ID` fallback),
  `RATE_LIMIT_MS`. Loaded via `--env=conf/.env`; `setup/reset.ts:loadEnv()` reparses it manually.
- `conf/defaults.json`: non-secret defaults - `lang: pt`, `prefix: .`, campus lat/long,
  `ai.gemini_chain` + `ai.gemini_pro`, cache caps
  (`users 200, groups 200, dmMsgs 60, groupMsgs 200`), and the `runner` table for `runCode` (yt-dlp
  path, per-language cmd/ext/triggers).
- `conf/bulletinTitles.json`: pool of PT bulletin headline strings.
- `conf/smufesrootca.pem`: extra CA bundle used by `start:dev`/`dev` tasks.

## 6. Domain models (`class/`)

- `class/baileys.ts`: `Baileys` singleton wrapper (`lid`, `sock`). `connect()` picks
  `postgresAuthState('2')` when `DATABASE_URL` is set, else Baileys
  `useMultiFileAuthState('conf/gen/auth')`. Socket opts: `markOnlineOnConnect:
  false`, macOS
  Desktop browser id, pinned version, `syncFullHistory: false`, `shouldIgnoreJid` filters
  bot/broadcast/newsletter/MetaAI/status JIDs.
- `class/cmd.ts`: abstract `Cmd` base every command extends. Fields: `name` (set by loader from
  filename), `alias`, `subCmds`, `cooldown` (default 3000, 0 allowed), `access` (`dm`, `groups`,
  `admin`, `botAdmin`, `restrict`, `needsDb`). `checkPerms` order: dev bypass via `DEVS` ->
  `restrict` (dev only) -> chat-type gate -> admin/botAdmin (devs bypass user-admin) -> `needsDb`
  (sends `events.nodb`) -> true. Reactions: user-fail `prohibited`, bot-fail `alert`, wrong chat
  `block`.
- `class/collection.ts`: capped `Map` with merge-on-add and oldest-first eviction; bounds memory for
  users/groups/media/msg caches.
- `class/user.ts`: per-user prefs + history. Lazy DB write-through setters (`name/lang/prefix`),
  `cmds` counter (`sql +1`), `memories` (JSON string), `gemini` (in-memory chat history, not
  persisted), `msgs` collection.
- `class/group.ts`: group metadata cache + `countMsg` (cache add plus `msgs` table upsert `count+1`,
  skipped without DB or for bot msgs) and `getCountedMsgs` (desc, feeds `rank`).

## 7. Shared types (`conf/types/`)

- `global.d.ts` (auto-loaded): `str/num/bool/Buf(=Uint8Array)/Func` shorthands, global `print`,
  `String` extensions (`align`, `toMs`, `getUrl`, `encode`, `parsePhone`, `toPascalCase`, `t`,
  `filterForRegex`, `bold`), `Number` extensions (`bytes`, `duration`), `UserDB`, `Media`, `AIMsg`,
  `Lang`.
- `types.d.ts`: `Msg`, `CmdCtx` (`msg, user, group?, args, cmd, startTyping,
  send, react, t`),
  `MediaMsg`, `GoogleFile`. Keeps class<->util imports acyclic.
- `msgs.ts`: Baileys raw-key sets (`textTypes`, `visualTypes`, `mediaTypes`, `coolTypes` countable
  subset) plus `isMedia`/`isVisual` guards. `getCtx` drops anything outside `coolValues`.

## 8. Utilities (`util/`)

- `handler.ts`: convention-over-config loader. `cmd/<cat>/<file>.ts` default-exports a `Cmd`
  subclass (name = filename); `event/<cat>/<file>.ts` default-exports a function where `cat.file`
  must equal a Baileys event name. `loadCmds` fills `cache.cmds`; `loadEvents` fills `cache.events`,
  `removeAllListeners(name)` then `ev.on(name, guarded dispatch)` so a bad handler or mid-reconnect
  `clear()` never throws synchronously.
- `proto.ts`: installs `global.print` logger (`[date|rss|TAG] - msg`, filters Baileys session
  noise), silent Baileys `logger` stub, `now()` (TZ-aware via defaults), `shortDuration()`, all
  `String`/`Number` prototype helpers.
- `locale.ts` + `locale/*.json`: i18next with Deno `readTextFile` backend, `preload` all five langs,
  `fallbackLng: en`. Access via `'key'.t(lang)` or `getFixedT(lang)(key, vars)`; `sendMsg`
  auto-localizes lookup keys.
- `msgTools.ts`: inbound core. `getCtx(raw)` builds `CmdCtx` (chat/author/type filter, group+user
  resolution, LID handling, pushName sync, media/quote download, prefix parse via `getInput` incl.
  quoted-text fallback for `.g`). `downloadMedia` unwraps view-once/ephemeral wrappers, caps
  `cache.media` at 20MB. `rescueOrphanQuote`/`deletedStore.savePendingQuote` handle replies to
  uncached messages.
- `msgAbstractions.ts`: the only outbound touchpoint. `sendMsg` localizes `usage.*` keys through the
  `help` command and other keys via i18n, then `sock.sendMessage` and returns a fresh `getCtx`.
  `reactToMsg` maps names through `emojis.ts`. `getMedia` prefers quoted media with cache fallback.
- `geminiApi.ts`: Gemini chat wrapper (file upload with polling, model config with url-context
  tool + HIGH thinking + PT system prompt + stored memories, `{MEMORY:..}` extraction, per-user
  history update, reply send). Called only by `cmd/fun/gemini.ts`.
- `functions.ts`: `delay`, `randomDelay` (anti-ban pacing, do not remove),
  `isValidPositiveIntenger`, recursive `findKey` (skips `quotedMessage`).
- `emojis.ts`: 34-emoji pool + `randomEmoji()` + named map (`ok`, `x`, `prohibited`, `block`,
  `alert`, `loading`, ...).
- `weather.ts`: Open-Meteo 1-day forecast for campus coords, WMO code map, tip line
  (umbrella/heat/coat), 5s timeout, null on failure.
- `menuParser.ts`: pure RU HTML -> `ParsedMenuResult` (breakfast items, lunch/dinner
  mains/sides/salads/desserts, hours, emojis).
- `calendarAnalytics.ts`: classifies `DD/MM/YYYY -> CalendarEvent[]` into new-today / ending-today /
  ongoing-student / other, with dup detection shared with the calendar parser.
- `bulletinTitles.ts`: non-repeating shuffled title picker persisted in
  `conf/gen/cache/bulletin_title_state.json`.
- `dailySummary.ts`: deterministic bulletin composer (header + weather + menu + calendar). The
  Gemini-composed path was removed after 15/15 prod failures; this is the only composer now.

## 9. Commands (`cmd/`, 18 files)

Loader sets `cmd.name` from filename; category dir is informational.

- `config/help.ts` (`help`, aliases `ajuda,menu,?`): list (non-restricted, sorted, localized desc)
  and detail (title, aliases, desc, usage, examples). Also renders `usage.*` keys on behalf of
  `sendMsg`.
- `config/language.ts` (`language`, alias `lang`): exact code, numeric index, or
  diacritic-insensitive native-name match across all locales.
- `config/prefix.ts` (`prefix`): per-user trigger, max 3 chars, DB-synced.
- `dev/ping.ts` (`ping`, alias `p`, public): WA latency via reaction round-trip plus DB latency,
  `-1` when no DB.
- `dev/memory.ts` (`memory`, restrict): `Deno.memoryUsage()` formatted with `.bytes()`.
- `dev/execute.ts` (`execute`, alias `run`, restrict, no cooldown): bash exec with duration + RSS
  header.
- `dev/eval.ts` (`eval`, alias `e`, restrict, no cooldown): polyglot eval via `runCode`; first arg
  selects `defaults.runner` language, default in-process eval with REPL scope (`bot`, `cache`,
  `sendURMenu`, ...).
- `fun/choose.ts` (`choose`): random pick from comma-separated options.
- `fun/gemini.ts` (`gemini`, alias `g`, cooldown 5s, subCmds `clean,reset,pro`): AI chat; `clean`
  clears history, `reset` also clears memories, `pro` uses `gemini_pro`; media attached via
  `getMedia`; `randomDelay` + typing first.
- `fun/rank.ts` (`rank`, groups only, needs DB): leaderboard from `group.getCountedMsgs()`, skipping
  users who left.
- `fun/sticker.ts` (`sticker`, aliases `s,sexo`, cooldown 5s, subCmds `rmbg,rounded,circle`):
  sticker factory; quality from `args[0]`; batch mode pulls contiguous same-author visuals from
  history when no media given; `rmbg` runs `plugin/removeBg.py`; formats
  `full,crop[,rounded,circle]`; EXIF pack `Ergon Bot` + author + date.
- `util/download.ts` (`download`, alias `d`, cooldown 10s): yt-dlp via `defaults.runner.ytdlp` with
  cookies, Chrome impersonation, retries, 2G cap; URL from text or quoted text; `a` suffix = mp3;
  over 256MB sent as document.
- `util/reveal.ts` (`reveal`, alias `r`): re-sends view-once media with caption (stickers back as
  images).
- `util/gotcha.ts` (`gotcha`, restrict): recovers deleted messages from `deletedStore` disk cache;
  resolves target by mention/JID/phone-digits/name substring/current chat; trailing number = limit;
  re-sends texts grouped by author plus media attachments.
- `util/clean.ts` (`clean`, groups only, admin + botAdmin, cooldown 10s, subCmd `reverse`): bulk
  delete of last N cached messages with pacing (500ms each, 1s per 10) plus disclaimer cleanup.
- `util/translate.ts` (`translate`, alias `t`, cooldown 5s): keyless Google translate via
  `translate.googleapis.com`, 10s timeout.
- `util/remove.ts` (`remove`, alias `rm`, cooldown 5s): background removal to PNG via
  `plugin/removeBg.py` with explicit output check and temp cleanup (image variant of
  `sticker rmbg`).
- `util/everyone.ts` (`everyone`, groups only, cooldown 5s): mass mention with anti-ban typing
  delay.

Cooldown model: `user.delay` stacks in `upsert.ts`, capped at `now + 10x`, warns `events.cooldown`
when under 10s, then `delay(timeout)` before `run`.

## 10. Events (`event/`, 6 files)

- `messages/upsert.ts` (`messages.upsert`): main pipeline. Skips empty messages; revoke-backup via
  `findKey(... 'protocolMessage')` type 0 -> `deletedStore.saveDeleted` (or promote pending);
  per-msg `getCtx` in try/catch; DEV-mode sender filter; metrics; group `countMsg` / DM history add;
  no-command -> `checkGroupAnnouncer`; binds `t/send/react/startTyping`; `checkPerms` gate;
  cooldown; `addCmd`; `cmd.run` in try/catch.
- `messages/update.ts` (`messages.update`): REVOKE archiver feeding `gotcha` (complements the upsert
  revoke path).
- `messaging-history/set.ts`: sync progress log only.
- `groups/update.ts` (`groups.update`): drops + refetches group cache on subject change, with
  anti-ban delay.
- `group-participants/update.ts`: in-memory member add/remove/promote/demote sync.
- `connection/update.ts` (`connection.update`): QR + reconnect lifecycle (see section 4), ends with
  `loadEvents()` + `reattachBridge()`.

## 11. Persistence

- `plugin/db.ts`: `drizzle` + `postgres-js` (`max: 5`), exported as `@db`. No `DATABASE_URL` ->
  warns once, `db = undefined`, everything degrades to cache/file mode. `getUser` (cache -> SELECT
  -> create), `getGroup` (cache -> `groupMetadata`, 403-safe null), `createUser`.
- `conf/schema.ts`: `users` (serial id, unique lid, name/memories/lang/prefix, cmds), `msgs`
  (author+group PK, count), `authCreds` (session PK, json data), `authKey` (session+category+key PK,
  indexed). `db:gen/push/pull` via drizzle-kit.
- `plugin/authState.ts`: Postgres auth backend used only with `DATABASE_URL` (hardcoded session
  `'2'`): creds row + per-key rows with BufferJSON round-trip; `app-state-sync-key` rehydrated via
  Baileys proto. File fallback: `useMultiFileAuthState('conf/gen/auth')` (creds + pre-key/identity/
  lid-mapping/app-state/device-list files).
- `plugin/cache.ts`: `CacheManager` - `cmds`/`wait` (unbounded), `users`/ `groups` (caps from
  defaults), `media` (100), `metrics` (msg/cmd per date), `events` map, `timeouts`. Only `metrics`
  hits disk (`conf/gen/cache/
  metrics.json`); `resume()` on boot, `save()` on exit and menu
  updates.
- `plugin/deletedStore.ts`: disk cache for `gotcha`: `conf/gen/deleted/<JID_SAFE>/index.json` +
  `media/` files, 100 entries per chat, pending-quote speculation + promotion,
  `downloadContentFromMessage` retry fetch for expired buffers.
- `conf/gen/` runtime layout: `auth/` (file auth), `cache/` (metrics, menu.txt, calendar JSON,
  bulletin state), `temp/` (calendar PDFs, runCode sources, sticker intermediates), `deleted/`
  (recovery cache), `bridge.db` (Telegram pairing), `cookies.txt` (yt-dlp sessions), `out.log`,
  `python/` venv. `deno fmt` excludes generated dirs; `deno task reset` wipes auth/cache/temp.

## 12. Plugins

- `plugin/bot.ts`: one-line `new Baileys()` singleton shared by WA core and bridge (sharing avoids
  stream-conflict logouts a second socket would cause).
- `plugin/memories.ts`: `{MEMORY:..}` protocol - extracts facts from AI output into `user.memories`
  (DB write-through), strips placeholders from reply text.
- `plugin/menuScraping.ts`: RU bulletin scheduler (Deno.cron: 6h BRT daily, 15-min weekday change
  checks, Sunday 3h BRT calendar refresh). Scrapes
  `restaurante.saomateus.ufes.br/cardapio/YYYY-MM-DD`, parses via `util/menuParser.ts`, diffs
  against `menu.txt`, composes via `util/dailySummary.ts` (weather + calendar inputs), sends to
  `GROUPS0` in DEV else `getAllowedTagsList()` + hardcoded group, pins for 24h.
- `plugin/groupAnnouncer.ts`: `#diurno`/`#noturno`/`#todos` fan-out across `GROUPS1`/`GROUPS2` with
  media/quote support, FIFO queue with 1-2.5s pacing.
- `plugin/runCode.ts`: multi-language runner driven by `defaults.runner`. `eval` runs in-process
  with REPL scope; file langs go to `conf/gen/temp/exec.{ext}` via `Deno.Command`; `cpp`/`rs`
  compile-then-run; `includes`/`notIncludes` triggers wrap snippets (e.g. missing `main`).
- `plugin/calendarParser.ts` + `plugin/calendar/`: UFES academic-calendar pipeline. `fetch.ts`
  scrapes prograd links, `curl` + `pdftotext -layout` converts; `parseBase.ts`/`blocks.ts` parse
  layout-positioned table lines; `batch.ts` assigns activity blocks to date centers;
  `parseResolution.ts` applies amendment/exclusion resolutions; `expand.ts` expands day ranges into
  `DD/MM/YYYY` keys with dup detection; `cache.ts:updateCalendarCache` writes
  `conf/gen/cache/calendar_<year>.json`. Debug via `scripts/dump_calendar.ts`.
- `plugin/sticker/`: custom engine. `index.ts:createStickers` (pool size 2, quality 80, 1MB cap);
  `image.ts` sharp resize + SVG circle/rounded masks; `pool.ts`/`worker.ts` Deno worker queue
  (max 8) for ffmpeg jobs; `ffmpeg.ts` single-pass multi-format libwebp encodes with adaptive
  quality levels (60/15fps down to 15/8fps), 11s video cap, 60s timeout; `exif.ts` EXIF via
  node-webpmux. `Buffer` (not `Uint8Array`) is required at the sharp/webpmux/Baileys boundary only.
- `plugin/removeBg.py`: rembg entry used by `sticker rmbg` and `remove`.

## 13. Gemini AI flow

`cmd/fun/gemini.ts` -> `getMedia(msg)` -> `util/geminiApi.ts:gemini()`: upload media via Files API
(30x2s PROCESSING poll) ->
`chats.create({model,
config: getModelConfig(user), history: user.gemini})` (url-context tool, HIGH
thinking, PT system prompt with memory protocol + stored facts) -> `sendMessage` -> prepend
`webSearchQueries` header (max 3) and `*model*:` header -> `createMemories` ->
`user.gemini = getHistory()` -> `sendMsg` quoted reply. Model chain in `defaults.json`
(`gemini_chain[1]` default, `gemini_pro` for `.g pro`).

## 14. Telegram bridge (`bridge/`)

Same-process design: `wa.ts` starts `startBridge()` after `loadEvents()` (which resets listeners),
and `connection/update.ts` calls `reattachBridge()` after every reconnect. Missing
`TELEGRAM_BOT_TOKEN`/`TELEGRAM_SUPERGROUP_PERSONAL` (legacy `TELEGRAM_SUPERGROUP_ID`) disables the
bridge (`null`) without stopping WA. `-- --find-id` CLI prints supergroup ids via `getUpdates`
without touching WA.

- `mod.ts`: builds `BridgeDB`, TG (3000ms) and WA (500ms) `RateLimiter`s, grammy `Bot`, registers
  both directions, `tg.start` long-poll with
  `allowed_updates: message, edited_message, message_reaction, callback_query, poll_answer`.
  `activeBridge` holds live refs for reattach. Boot warns when the bot lacks admin (reactions) or
  pin rights (pin sync), and resolves the owner TG identity (`TELEGRAM_OWNER_ID` else the personal
  supergroup creator) for @all/@mention pings.
- `db.ts`: SQLite WAL at `conf/gen/bridge.db`. `mappings` (WA JID <-> TG topic, chat type,
  archived/muted flags, last-active) and `reply_map` (TG msg <-> WA key + kind + text/entity
  snapshot + poll crypto columns + live poll vote roster + per-message secret for encrypted edits,
  pruned past 7d). In-memory echo sets (`pendingTgEdits`, `pendingTgReacts`, `pendingTgPins`,
  `pendingFollowUps`, 1000-cap) suppress relaying our own TG edits/reactions/
  pins/caption-follow-ups back.
- `format.ts`: pure converters - TG entities (UTF-16 offsets) to WA inline markers (`*bold*`,
  `_italic_`, `~strike~`, `` `code` ``, triple-backtick pre, links, `> quote`) and back (pre -> bold
  -> italic -> strike -> code passes).
- `rate-limiter.ts`: one global FIFO queue per limiter; every `tg.api.*` call takes a slot; 429s
  retry unbounded (front-requeue, `retry_after + 500ms`, max 120s) so nothing is dropped; queue over
  500 applies producer backpressure.
- WA->TG (`wa-to-tg.ts` facade + 33 modules): `relay.ts` attaches seven socket listeners (upsert,
  reaction, update, delete, call, group-participants, groups); `incoming.ts` is the main loop (skip
  protocol/reaction/status, echo-dedupe via `reply_map`, canonicalize LID/PN via `jid.ts`,
  resolve/create topic in the chat's group, mentions, media download, special-content degrade, then
  hand off); `dispatch.ts` assembles the body (quote resolve, label, entities, sticker fallback),
  routes album-or-direct and fires the classification prompt for undecided chats; `chat.ts` owns
  name resolution (own pushName ignored for outgoing 1:1) and topic creation; `topics.ts` owns the
  mapping ensure (per-JID in-flight lock, LID/PN alias healing with bucket kept, outgoing never
  renames, 1:1 renames update the forum title); `routing.ts` resolves the personal/business home
  group (`TELEGRAM_SUPERGROUP_PERSONAL/_BUSINESS`, legacy fallback, single-group mode when equal);
  `move.ts` moves topics across groups (business: clean cut, personal: newest-100 `copyMessage`
  replay sourced from each row's home group with re-threading, old topic closed with pointer);
  `prompt.ts` posts the Personal/Business button prompt once per new chat; `db.ts` `jid_aliases`
  maps user LID<->PN variants to the canonical JID (group sender alts are never stored; boot purges
  mixed rows) plus `bucket`/`telegram_chat_id`/`prompt_msg_id` routing columns and a composite
  `(tg_chat_id, tg_msg_id)` reply key; `text.ts` unwrap + `@Name (+phone)` annotation + owner
  `text_mention` spans (`@all` via `nonJidMentions`, direct via owner-JID match, merged into
  entities by `dispatch.ts`/`edits.ts`); `media.ts`/`media-utils.ts` download + size/ext;
  `send.ts`/`send-media.ts` route by kind (photo/video/animation/voice/audio/sticker/document,
  1024-char caption overflow follow-ups, round video-note fallback); `quote.ts` reply-target gated
  on the destination group (stranded pre-move rows degrade to the header) or `author: preview`
  header; `album.ts`/`album-flush.ts` 1.5s window -> `sendMediaGroup` (singletons arrive ~1.5s late
  by design, chunk send + caption follow-up in `album-send.ts`); `edits.ts` (text in place, caption
  fallback, sticker/special skip); `deletes.ts` (spoiler tombstone `... Deleted on WhatsApp` reusing
  stored snapshot, else hard delete + drop mapping); `reactions.ts` (emoji normalize,
  last-writer-wins, `REACTION_INVALID` -> heart retry, shared `applyTgReaction`);
  `reaction-summary.ts` (opt-in author-attributed summary beside the popular-emoji mirror);
  `pins.ts` (pin/unpin carriers resolve the mirror via `reply_map`, pin natively with a service
  line, TG echoes consumed via the `pendingTgPins` guard); `calls.ts` (one editable notice per call
  id across offer/ringing/ accept/reject/timeout/terminate, missed vs ended lines); `polls.ts` (poll
  crypto metadata, vote decrypt, result lines, vote encrypt + relay); `poll-tally.ts` (live per-poll
  tally - one edited message showing per-option counts, percentages and voters, folding to a one-off
  per-vote reply line when no tally message can be posted); `rich.ts` (contacts, invites, events,
  scheduled calls, sticker packs and offline call logs as text notices); `special.ts`
  (location/contact/poll mapping); `unsupported.ts`/`unsupported-preview.ts` friendly
  `type
  (rawKey) + preview + sender` notices; `errors.ts` log triage; `state.ts` shared ctx +
  `tgCall` queue + `notifyTopic` (never throws/loops).
- TG->WA (`tg-to-wa.ts` facade + 9 modules): `handlers.ts` guards (either group, no bots, has topic,
  mapping active/unmuted), entity conversion, 20MB-capped download, `media_group_id` album buffering
  (1.2s window, ordered singles - Baileys has no album API), quote stub or fallback header,
  `waSend` + `saveReplyMap` (chat + reply target stored); `handler-events.ts`
  reaction/edit/pin/poll-answer handlers with echo marks (pin resolves `pinned_message` service
  posts back to the WA original, 30-day duration; poll answers rebuild the encrypted vote);
  `buckets.ts` Personal/Business buttons (`callback_query`, chat resolved via stored prompt ID) plus
  `/personal` `/business` topic commands, serialized per chat (double-tap never opens two topics);
  `content.ts` WA payload builders (`Buffer.from` at boundary, webm->webp transcode, tgs->document,
  native poll creation, contact text fallback); `media.ts` largest-photo pick + `getFile` fetch with
  double size caps; `replies.ts` notices + ffmpeg webm conversion; `album.ts` batching;
  `commands.ts` topic admin (`/start /id /topics /archive /close /reopen /mute /unmute`);
  `newchat.ts` `/new <phone> [name]` with `onWhatsApp` verification (inherits the group's bucket).
- Cross-cutting: pairing auto-creates on first WA sight (or `/new`) into the personal group as
  `undecided` until the buttons/commands classify it; renames sync, mute/archive pause both
  directions; edits bounded by TG 48h / WA ~15min windows; deletes are WA->TG only (TG exposes no
  delete event); pins sync both ways except TG->WA unpin (no Bot API update on unpin); reactions
  need bot admin + opt-in `allowed_updates` (now including `callback_query`); every failure becomes
  a topic `warning` notice + log, never a throw or loop. `scripts/bridge_buckets.ts` bulk-classifies
  existing chats (dry-run default, `--yes` applies).

## 15. Setup wizard (`setup.ts` + `setup/`)

`deno task wizard` runs `setup/wizard.ts:main()` - a 6-option loop (setup, update, start/restart
foreground vs PM2, stop, reset, exit). `env.ts` prompts language (discovers `locale/*.json`),
prefix, TZ, `DATABASE_URL`, `DEVS`, Gemini keys, preserves unknown keys, writes `conf/.env` +
`defaults.json`. `runners.ts` implements Light (deps), Medium (+ Python venv), Strong (+ `db:push`)
setups and `git pull + reinstall + db:gen` updates without a shell. `reset.ts` does Light reset
(wipe `conf/gen/{auth,cache,temp}`) and Strong reset (truncate auth tables), plus a manual `.env`
parser.

## 16. Conventions AI agents must follow (`agents.md`)

- Imports in every file sorted descending by line length (longest first), keeping logical statement
  order (do not break code to satisfy order).
- No file over 150 lines - split into small modules or folders.
- Every file starts with a `//` header comment (what + why); functions and non-obvious code get
  comments.
- Clean Code, SOLID, KISS, YAGNI, DRY; small pure single-responsibility functions, composition over
  inheritance, explicit errors, early returns.
- Deno-only priority: (1) Deno/Web APIs (`Deno.*`, `fetch`), (2) std/JSR, (3) Deno-first packages,
  (4) npm last resort (current npm: baileys, grammy, genai, i18next, sharp, webpmux, drizzle,
  postgres).
- No em/en dashes in user-facing strings - use `-`.
- After code changes run in order with no file args: `deno check`, `deno lint`, `deno fmt`.
- Agent scratch/dev scripts live under `scripts/`, never repo root.
- Commits: atomic Conventional Commits (`type(scope): short description`), one logical change each;
  never bundle unrelated changes.

## 17. Research guide (start here per task)

- New command: `class/cmd.ts` + `util/handler.ts` + one `cmd/fun/choose.ts` (minimal example) +
  `conf/types/types.d.ts:CmdCtx`.
- Inbound debug: `event/messages/upsert.ts` -> `util/msgTools.ts:getCtx` ->
  `util/msgAbstractions.ts`.
- Outbound/send bug: `util/msgAbstractions.ts` only; check `checkPerms` in `class/cmd.ts` for silent
  gates.
- Reconnect/auth: `event/connection/update.ts` + `class/baileys.ts` + `plugin/authState.ts`.
- DB/cache: `conf/schema.ts` + `plugin/db.ts` + `plugin/cache.ts` + `class/user.ts` /
  `class/group.ts`.
- Stickers: `cmd/fun/sticker.ts` -> `plugin/sticker/index.ts` ->
  `image.ts`/`ffmpeg.ts`/`pool.ts`/`exif.ts`.
- Bulletin wrong: `plugin/menuScraping.ts` -> `util/menuParser.ts`, `util/weather.ts`,
  `plugin/calendar/cache.ts`, `util/calendarAnalytics.ts`, `util/dailySummary.ts`.
- Bridge WA->TG: `bridge/wa-to-tg/relay.ts` -> `incoming.ts` -> `send.ts`; TG->WA:
  `bridge/tg-to-wa/handlers.ts` -> `content.ts`; pairing: `bridge/db.ts`.
- Deleted recovery: `plugin/deletedStore.ts` + `cmd/util/gotcha.ts` + `event/messages/update.ts`.
- Env/setup: `conf/.env.example` + `setup/env.ts` + `setup/runners.ts`.

## 18. Gotchas

- Bridge must attach after `loadEvents()`; reattach after every reconnect or relay listeners are
  silently gone.
- `loadEvents` wipes listeners per event name; anything else listening on `sock.ev` (bridge) must
  re-register too.
- `user.lid` vs phone JID: `checkMatch` merges `@lid` / `@s.whatsapp.net` duplicates; always compare
  via LID where possible.
- `rank` and `needsDb` commands silently degrade without `DATABASE_URL`.
- `cache.media` 20MB cap and bridge 20MB TG cap: large media produce failure lines, not crashes.
- Random delays are intentional anti-ban pacing; do not remove.
- `sticker`/`Buffer`: `Buf` is `Uint8Array` everywhere except the sharp/webpmux/Baileys boundary,
  which needs real `Buffer`.
- `todo.md` tracks one item: store group keys before sending.
