# Deep Research Report — ergon-wa-bot

**Date:** 2026-10-30
**Scope:** Entire codebase (class/, cmd/, event/, plugin/, util/, wa.ts, setup/, scripts/, locale/, conf/, docs/). Excludes node_modules and conf/gen runtime state.
**Method:** Static analysis, `deno check` / `deno lint` / `deno fmt --check`, file-size and line-count metrics, clone/duplication scan, targeted grep audits, and four parallel deep-dive sub-audits (performance, duplication, UI/UX, architecture/compliance).
**Verification baseline:** `deno check` clean, `deno lint` clean (148 files), `deno fmt --check` reports 1 unformatted file (`docs/transcrypt-plan.md`).

**No code was modified.** This report is advisory only.

---

## Executive summary

The codebase is in good shape: type check and lint are green, most in-memory caches are capped, sync FS is confined to startup/setup/worker threads, subprocess spawns use async `.output()`, and permission gating is centralized. The dominant improvement opportunities are:

1. **Per-message O(N) cache scans** in `plugin/db.ts` (`getUser`) and `deletedStore.ts` (`findCachedOriginal`) — biggest CPU win on the hot path.
2. **O(N²) byte-budget eviction** in `class/collection.ts`.
3. **Repeated proto-tree traversal** (`findKey`) per message in `util/msgTools.ts` and `plugin/bridge/wa-to-tg/incoming.ts`.
4. **Several files far over the ~300-line review threshold** (db.ts 958, reaction-summary.ts 753, group-menu.ts 484, polls.ts 412, rate-limiter.ts 411, proto.ts 395, deletedStore.ts 394, msgTools.ts 357).
5. **Missing i18n keys for `gotcha`** (users see literal keys) and many hardcoded user-visible strings in commands.
6. **Exact duplicate functions** (`shortErr`, twin-resolver, `getEndDate`, `getMsgText`, scripts `check`) and a repeated mapping-resolution block across ~10 bridge handlers.
7. **Unbounded queues/maps** (`groupAnnouncer.msgQueue`, `pendingCoalesced`, `pendingAlbums`, `pendingService`).
8. **Permission failures are emoji-only** with no text fallback; bridge command handlers silent on missing mapping.

Estimated impact if the top items are addressed: lower per-message CPU, lower memory under burst load, smaller diff surface for future changes, and a noticeably more consistent user experience across languages.

---

## 1. Architecture & agents.md compliance

### 1.1 Files without a `//` header (use `/**` JSDoc instead)
Rule (agents.md §5 Comments): "Every file starts with a `//` header comment." These seven use block comments:

- `plugin/sticker/exif.ts`
- `plugin/sticker/ffmpeg.ts`
- `plugin/sticker/image.ts`
- `plugin/sticker/index.ts`
- `plugin/sticker/pool.ts`
- `plugin/sticker/types.ts`
- `util/emojis.ts`

Severity: Low. Fix: convert the first block to a `//` header (or document an exception).

### 1.2 Oversized files (>300 lines, must be reviewed for splitting)
From `wc -l`:

| File | Lines |
|---|---|
| `plugin/bridge/db.ts` | 958 |
| `plugin/bridge/wa-to-tg/reaction-summary.ts` | 753 |
| `plugin/bridge/tg-to-wa/group-menu.ts` | 484 |
| `plugin/bridge/wa-to-tg/polls.ts` | 412 |
| `plugin/bridge/rate-limiter.ts` | 411 |
| `util/proto.ts` | 395 |
| `plugin/deletedStore.ts` | 394 |
| `util/msgTools.ts` | 357 |
| `plugin/bridge/wa-to-tg/send.ts` | 350 |
| `plugin/bridge/wa-to-tg/poll-tally.ts` | 279 |
| `plugin/bridge/wa-to-tg/incoming.ts` | 259 |
| `plugin/bridge/mod.ts` | 255 |
| `plugin/health.ts` | 243 |
| `plugin/bridge/wa-to-tg/text.ts` | 243 |
| `plugin/bridge/wa-to-tg/move.ts` | 242 |
| `plugin/sticker/ffmpeg.ts` | 229 |
| `event/connection/update.ts` | 228 |
| `plugin/bridge/tg-to-wa/handlers.ts` | 216 |
| `plugin/bridge/wa-to-tg/calls.ts` | 215 |
| `util/calendarAnalytics.ts` | 211 |
| `plugin/bridge/wa-to-tg/profile.ts` | 210 |
| `util/menuParser.ts` | 208 |
| `cmd/util/gotcha.ts` | 202 |

Severity: Medium. Note: agents.md says ~300 lines is the point a file must be reviewed for splitting, and not to split cohesive code merely to hit a target. The bridge/db.ts and reaction-summary.ts are the clearest split candidates (multiple concerns). `util/proto.ts` and `util/msgTools.ts` are borderline but cohesive.

### 1.3 `as any` / unchecked casts (72 occurrences)
Most are unavoidable Baileys/grammy untyped access (`bot.sock as any`, `ctx.msg as any`). Recurring patterns that could be typed once:

- `(ctx.msg as any)?.message_thread_id` — repeated in `plugin/bridge/tg-to-wa/{commands,group-menu,buckets,handlers}.ts` (8+ sites). Suggest a typed helper `threadIdOf(ctx)`.
- `(bot.sock as any)?.signalRepository?.lidMapping` — repeated in `jid.ts`, `contact-names.ts`, `polls.ts`, `secret-edits.ts`, `reaction-summary.ts`, `group-menu.ts`. Suggest a `lidMappingOf(sock)` accessor on `class/baileys.ts` or `plugin/bot.ts`.
- `globalThis as any` for metric counters (`__healthCounts`, `__waDlFail`, `__signalErrorCounts`, `__relayCtxMod`, `__getDisconnectStats`) — hacky; a typed global or a module-level registry would be cleaner and safer.

Severity: Medium (maintainability/type-safety). Not a correctness bug.

### 1.4 `console.*` usage (282 occurrences across ~40 files)
The project's logging convention is `global.print` (`[date|rss ...|TAG] - msg`). `console.*` is used widely, especially in bridge modules and setup. This is inconsistent with the logging standard and bypasses the RSS/loop-lag context.

Severity: Medium. Suggest: lint rule or convention to prefer `print` in runtime code; keep `console` only in scripts/setup.

### 1.5 Em dashes in docs
`docs/transcrypt-plan.md` uses `—` (em dash) in several places. Rule (agents.md §4): no em dashes in docs; use hyphens.

Severity: Low.

### 1.6 Formatter
`deno fmt --check` reports 1 unformatted file: `docs/transcrypt-plan.md` (long lines). Fix: `deno fmt`.

### 1.7 Hard-coded catalogs/counts
Many performance caps are hardcoded in code rather than `conf/defaults.json` (e.g., `cache.media` 100/64MB in `plugin/cache.ts`, `MAX_VOTERS` 100 in `reaction-summary.ts`, `MEM_CACHE_CAP` 500 in `contact-names.ts`, `BUSY_DEPTH` 100 in `outbox.ts`, `MAX_ALBUM_BYTES` 40MB in `album.ts`). agents.md §7/§9 says tunables belong in env + `conf/defaults.json`. These are internal perf caps; documenting them is fine, but making the user-facing ones configurable would align with the contract.

Severity: Low-Medium.

### 1.8 Import ordering
agents.md §6: imports organized descending by line length. Spot checks show most files comply. Not fully verified across all 148 files; a full check would require an automated script. (Not a blocker; `deno fmt` does not enforce import order.)

### 1.9 Commented-out code / TODO format
No `TODO` markers found (searched). No commented-out code blocks detected. Good.

### 1.10 Security/privacy markers
`// SECURITY:` and `// PRIVACY:` markers are used sparingly. Given the agents.md emphasis, permission gates, ownership checks, and recovery-cache spots should carry these markers. Audit recommended but not enumerated here.

---

## 2. Performance & CPU

### 2.1 Critical — O(N) cache scans on the hot path
- `plugin/db.ts:51,63` — `getUser` does `cache.users.find((u) => u.lid === lid)` and `cache.users.find((u) => u.id === id)`. O(N) per lookup, called on every inbound message (upsert + bridge). Fix: maintain `Map<lid, User>` and `Map<id, User>` indexes updated on `createUser`/add.
- `plugin/deletedStore.ts:121-139` — `findCachedOriginal` scans users + all groups' collections per delete. Fix: index messages by id, or resolve owning chat first.

### 2.2 Critical — O(N²) byte-budget eviction
- `class/collection.ts:24-66` — `bytes` recomputes total by iterating all values inside the eviction `while` loop. Evicting K entries costs O(K·N). Fix: track a running `byteTotal`.

### 2.3 High — repeated proto-tree traversal
- `util/functions.ts:11-36` — `findKey` recursively walks the proto tree. Called many times per message via `util/msgTools.ts` (`getCtx`, `getMsgType`, `getMsgText`, `getQuoted`) and `plugin/bridge/wa-to-tg/incoming.ts` (10+ calls per message). Fix: single unwrapping pass per message, or memoize per message object (WeakMap).

### 2.4 High — per-message DB writes
- `event/messages/upsert.ts:82-93` + `class/group.ts:45-74` — `Group.countMsg` does a DB `INSERT ... ON CONFLICT` per message, with a 1s retry sleep on failure. Fix: batch/debounce counts, or accumulate in memory and flush periodically.

### 2.5 High — unbounded queues/maps
- `plugin/groupAnnouncer.ts:28` — `msgQueue: Announcement[]` unbounded; may hold media buffers. Add a cap.
- `plugin/bridge/wa-to-tg/coalesce.ts:96` — `pendingCoalesced` Map unbounded by chat count.
- `plugin/bridge/wa-to-tg/album.ts:29` — `pendingAlbums` no cap.
- `plugin/bridge/wa-to-tg/service-batch.ts:39` — `pendingService` unbounded by chat count.

### 2.6 High — memoization gaps
- `plugin/bridge/wa-to-tg/jid.ts:132` — `canonicalChatJid` awaits `lidMapping.getPNForLID` per LID message. Memoize by LID (short TTL).
- `plugin/bridge/wa-to-tg/contact-names.ts:61-72` — `counterpartOf` awaits lidMapping per name resolution. Cache.
- `plugin/authState.ts:64-73` — `rows.find` inside `ids.map` is O(ids×rows). Build a Map first.
- `plugin/bridge/wa-to-tg/poll-tally.ts:92-105` — `renderTally` O(options×voters). Precompute counts in one pass.

### 2.7 Medium — listener cleanup gaps
- `plugin/sticker/pool.ts:87-121` — crashed workers are replaced via `spawn()` without terminating the dead worker or removing its listeners. Fix: terminate + remove listeners on crash.
- `plugin/bridge/wa-to-tg/relay.ts` — additional listeners attach to new sockets but old-socket listeners are not explicitly removed (health watchdog does this correctly; replicate the pattern).

### 2.8 Medium — eager import
- `wa.ts:4` — `scheduleURMenuMsg` from `@plugin/menuScraping.ts` is eagerly imported even when `GROUPS1` is unset. Consider dynamic import inside the existing `if (Deno.env.get('GROUPS1'))` block.

### 2.9 Low — dead state
- `plugin/cache.ts:22,44` — `timeouts: Map` is declared and never used. Remove or cap.

### 2.10 Not a problem (verified)
- Sync FS confined to startup/setup/worker thread.
- Subprocess spawns use async `.output()`.
- Most maps (`msgRetryCounterCache`, `groupMetaCache`, `closedCalls`, `metaCache`) are capped.
- No sub-second polling; intervals are 15s+ or event-driven.
- `Collection` enforces item limits for users/groups/media.

---

## 3. Duplication

### 3.1 Exact duplicate functions (High — easy, zero-risk)
| Function | Locations |
|---|---|
| `shortErr` | `plugin/bridge/wa-to-tg/state.ts:129`, `plugin/bridge/tg-to-wa/replies.ts:55` |
| LID/PN twin resolver | `plugin/bridge/wa-to-tg/reaction-summary.ts:195`, `plugin/bridge/wa-to-tg/secret-edits.ts:67` |
| `getEndDate` | `util/calendarAnalytics.ts:205`, `util/dailySummary.ts:152` |
| `getMsgText` | `util/msgTools.ts:338`, `plugin/bridge/wa-to-tg/text.ts:46` |
| `check` (test helper) | `scripts/coalesce_smoke.ts:10`, `scripts/outbox_smoke.ts:19` |

### 3.2 Near-duplicate functions (Medium-High)
- `notifyTopic` — `plugin/bridge/wa-to-tg/state.ts:106` vs `plugin/bridge/tg-to-wa/replies.ts:32` (same intent, different signatures).
- `windowFor` — `plugin/bridge/wa-to-tg/coalesce.ts:41` vs `plugin/bridge/wa-to-tg/service-batch.ts:19` (thresholds/env differ only).

### 3.3 Repeated mapping-resolution block (Medium)
Same 6-line pattern in ~10 bridge handlers (deletes, edits, pins, polls×2, reaction-summary×2, secret-edits, calls). Suggest `resolveMapping(db, key)` helper.

### 3.4 Repeated JID normalization (Medium)
Manual `jid.split('@')[0].split(':')[0]`, `.endsWith('@g.us')`, phone extraction scattered across `group-menu.ts`, `group-members.ts`, `newchat.ts`, `text.ts`, `chat.ts`, `profile-events.ts`, `gotcha.ts`, `msgAbstractions.ts`. 17 uses of `.endsWith('@g.us')` vs 5 of `isGroupJid`. Migrate to helpers in `plugin/bridge/wa-to-tg/jid.ts`.

### 3.5 Repeated media download/upload (Medium)
`util/msgTools.ts:162` `downloadMedia` and `plugin/bridge/wa-to-tg/media.ts:62` `downloadWaMedia` both call `downloadMediaMessage` with retry. Suggest a shared `downloadWithRetry`.

### 3.6 Repeated coalescing window logic (Low-Medium)
`coalesce.ts`, `service-batch.ts`, `tg-to-wa/coalesce.ts` share env-parsing + pressure-stretching. Parameterize.

### 3.7 Repeated locale/i18n lookup (Low)
`getFixedT(lang)(key)` in upsert, msgAbstractions, language command. Suggest `tFor(user, key, opts)`.

### 3.8 Repeated try/catch + logging (Low)
Identical `return null } catch { return null }` in `media.ts`, `reaction-summary.ts`, `secret-edits.ts`, `special.ts`. Identical callback guards in `polls.ts`, `reaction-summary.ts`, `handler-events.ts`, `buckets.ts`, `handlers.ts`.

### 3.9 Repeated JSON.parse guards (Low)
`restoreWaKey`, `buildQuoted`, polls, secret-edits. Suggest `parseJsonSafe(str, fallback)`.

### 3.10 Repeated owner/permission/bucket guards (Low-Info)
Bridge bucket guards repeated across ~6 files. Could become middleware.

---

## 4. UI/UX (senior designer perspective)

### 4.1 Critical (P0)
1. **Missing `gotcha` locale keys.** `cmd/util/gotcha.ts` calls `t('gotcha.noTarget')`, `t('gotcha.multi')`, `t('gotcha.empty')`, `t('gotcha.unavailable')`, `t('gotcha.noText')`, `t('gotcha.header')`, `t('gotcha.expired')`, but no `gotcha` namespace exists in any locale file. Users see literal i18n keys. Fix: add `gotcha` block to all five locales (pt canonical).
2. **Hardcoded user-facing strings bypassing i18n** in `cmd/fun/gemini.ts` (39,43,56), `cmd/util/download.ts` (114), `cmd/util/reveal.ts` (38-40), `cmd/fun/sticker.ts` (pack metadata), `cmd/util/everyone.ts` (30), `cmd/fun/rank.ts` (14), `cmd/config/help.ts` (19). Move to locale.
3. **Transcription header inconsistent.** `cmd/util/transcrypt.ts:86` uses `t('transcrypt.header')` (cached) but `:97` hardcodes `*[🎙️] - Transcription (...)*`. Unify.
4. **Permission failures are emoji-only.** `class/cmd.ts:54,59,65,70,73` react and return with no text. Add a short localized notice (or text fallback).
5. **Bridge command handlers silent on missing mapping.** `plugin/bridge/tg-to-wa/commands.ts` (archive/close/reopen/mute/unmute) reply only when mapping found. Add `else` feedback.

### 4.2 High (P1)
6. **Broken Markdown bold in several locales.** Spaces inside asterisks prevent bold rendering: `locale/fr.json` (14,15,16,25,26,27,39,50,63), `de.json` (26,50), `en.json` (26,27,39,50), `es.json` (26,27,39,50), `pt.json` (27,28,39,51). Remove inner spaces.
7. **Invalid command names in help examples (es/fr/de).** `locale/es.json:22-23` ("Géminis", "etiqueta engomada"), `fr.json:22-23` ("Gémeaux", "autocollant"), `de.json:22-23` ("Zwillinge", "Aufkleber") are not real commands. Standardize to `["", "sticker", "gemini"]`.
8. **Inconsistent `help.examples` coverage.** pt has bare-command example `""` first; en/es/fr/de omit it.
9. **`language.examples` inconsistent format.** pt shows inputs; en/es/fr/de show language-list rows.
10. **`prefix.usage` misleading.** All locales say "up to 3 digits" but accepts any ≤3 chars. Change to "up to 3 characters (letters or symbols)".
11. **Cooldown copy nonsensical.** "taxed"/"gravado"/"taxé"/"besteuert" should be "slow down / wait a bit".
12. **Inconsistent capitalization in language names.** es lowercase; pt "Frances" missing accent; fr/de mixed case.
13. **Bridge notices English-only.** All `plugin/bridge/` notices hardcoded English while WA UI is pt-BR. Either document English as bridge canonical or route through i18n.
14. **Date/time uses server locale.** `cmd/util/gotcha.ts:108,171` uses `toLocaleString()` with no locale/TZ. Use `toLocaleString(user.lang, { timeZone })`.
15. **Transcription header (see 4.1.3).**

### 4.3 Medium (P2)
16. **Missing loading/progress indicators.** `rank.ts`, `clean.ts`, `gemini.ts` (typing starts after delay).
17. **Long messages not chunked.** `gotcha.ts` `sendTexts`, `dev/eval.ts`/`execute.ts` output. Add chunking/truncation.
18. **Inconsistent button/callback UX.** `group-menu.ts` mixes toast + durable messages; some callbacks no toast; silent no-op outside group topic (`group-menu.ts:303-306`).
19. **Empty states.** `group-menu.ts:126` "No matches." lowercase; `commands.ts:40` "No active topics yet."
20. **Emoji/visual consistency.** Inconsistent brackets (`[⚠️]` vs `⚠️`); `download.ts` uses `emojis['alert']` while others literal `[⚠️]`.
21. **Accessibility.** Color/emoji-only status; reactions-only feedback (see 4.1.4).
22. **Mobile/WhatsApp rendering.** `dailySummary.ts` long lines; eval output code blocks not wrapped.
23. **Tone inconsistency.** `clean.noAmount` playful/accusatory in en/es/fr/de vs pt neutral.

### 4.4 Low (P3)
24. **Typos/grammar.** `es.json:15` `<ROBLECTORIO>`; `fr.json:31` "langue des bot"; `de.json:53` stray hyphen; `pt.json:3` slang.
25. **Whitespace nits.** Trailing spaces before closing bold in many templates; `en.json:3` trailing space.
26. **README/docs.** Mixed emoji decoration (not runtime).

---

## 5. Cross-cutting recommendations (priority order)

### Tier 1 (highest impact, lowest risk)
1. Add `gotcha` locale block + fix help examples command names (P0/P1).
2. Centralize hardcoded command strings into `locale/*.json`.
3. Fix Markdown bold spacing in all locale files.
4. Add text fallback for permission failures.
5. Add `else` feedback in bridge command handlers.
6. Unify cooldown wording and prefix usage text.
7. Add lid/id indexes to `cache.users` (biggest per-message CPU win).
8. Make `Collection` track a running byte total.
9. Consolidate `findKey` traversals in `getCtx`/bridge `incoming`.
10. Extract exact-duplicate functions (`shortErr`, twin-resolver, `getEndDate`, `getMsgText`, scripts `check`).

### Tier 2 (medium impact)
11. Batch/debounce per-message DB writes in `Group.countMsg` and `User.addCmd`.
12. Memoize `canonicalChatJid`/`counterpartOf`.
13. Fix O(N²) in `authState` key fetch and poll tally render.
14. Cap `msgQueue` and coalesce/album/service maps; fix worker listener cleanup.
15. `resolveMapping(db, key)` helper; migrate `.endsWith('@g.us')` → `isGroupJid`.
16. Shared media download retry wrapper.
17. Dynamic-import `menuScraping` in `wa.ts`.
18. Split `plugin/bridge/db.ts` and `reaction-summary.ts`.
19. Remove dead `cache.timeouts` Map.
20. Replicate listener cleanup in `attachWaRelay`.

### Tier 3 (polish)
21. `parseJsonSafe`, `tFor`, bridge bucket-guard middleware.
22. Standardize try/catch logging; prefer `print` over `console`.
23. Chunk long WA→TG text and eval output.
24. Standardize date/time formatting with user locale.
25. Convert 7 JSDoc-header files to `//` headers.
26. Fix em dashes in `docs/transcrypt-plan.md`; run `deno fmt`.
27. Add `// SECURITY:`/`// PRIVACY:` markers at gates.
28. Document or externalize hardcoded perf caps into `conf/defaults.json`.

---

## 6. Compliance deep-dive (sub-agent findings)

### 6.1 Missing file headers (Python)
- `plugin/removeBg.py:1` — no `#` header.
- `scripts/transcribe.py:1` — no `#` header.
All `.ts` files have a header (7 use `/**` instead of `//` — see 1.1).

### 6.2 Imports not sorted descending by line length (38 files)
Full list: `cmd/util/transcrypt.ts`, `event/groups/update.ts`, `plugin/bridge/mod.ts`, `plugin/bridge/tg-to-wa.ts`, `plugin/bridge/tg-to-wa/coalesce.ts`, `plugin/bridge/tg-to-wa/group-menu.ts`, `plugin/bridge/tg-to-wa/handler-events.ts`, `plugin/bridge/tg-to-wa/handlers.ts`, `plugin/bridge/tg-to-wa/newchat.ts`, `plugin/bridge/tg-to-wa/replies.ts`, `plugin/bridge/wa-to-tg/album-send.ts`, `plugin/bridge/wa-to-tg/calls.ts`, `plugin/bridge/wa-to-tg/chunk.ts`, `plugin/bridge/wa-to-tg/deletes.ts`, `plugin/bridge/wa-to-tg/dispatch.ts`, `plugin/bridge/wa-to-tg/edits.ts`, `plugin/bridge/wa-to-tg/incoming.ts`, `plugin/bridge/wa-to-tg/move.ts`, `plugin/bridge/wa-to-tg/outbox.ts`, `plugin/bridge/wa-to-tg/pins.ts`, `plugin/bridge/wa-to-tg/poll-tally.ts`, `plugin/bridge/wa-to-tg/polls.ts`, `plugin/bridge/wa-to-tg/profile-events.ts`, `plugin/bridge/wa-to-tg/profile.ts`, `plugin/bridge/wa-to-tg/reaction-summary.ts`, `plugin/bridge/wa-to-tg/relay.ts`, `plugin/bridge/wa-to-tg/rich.ts`, `plugin/bridge/wa-to-tg/secret-edits.ts`, `plugin/bridge/wa-to-tg/send-media.ts`, `plugin/bridge/wa-to-tg/send.ts`, `plugin/bridge/wa-to-tg/state.ts`, `plugin/bridge/wa-to-tg/text.ts`, `plugin/bridge/wa-to-tg/topics.ts`, `plugin/db.ts`, `plugin/runCode.ts`, `scripts/bridge_buckets.ts`, `scripts/outbox_smoke.ts`, `setup/env.ts`.

### 6.3 Files >300 lines (9 files)
See 1.2 table (9 files exceed 300).

### 6.4 Functions >40 lines (88 sites)
Top offenders: `plugin/bridge/tg-to-wa/handlers.ts:19` (198), `plugin/bridge/db.ts:142` (180), `util/calendarAnalytics.ts:40` (164), `plugin/bridge/wa-to-tg/media.ts:43` (153), `util/menuParser.ts:67` (142), `setup/env.ts:15` (136), `event/messages/upsert.ts:16` (135), `event/connection/update.ts:50` (135), `plugin/bridge/wa-to-tg/polls.ts:279` (134), `plugin/bridge/tg-to-wa/group-menu.ts:350` (134), `plugin/calendar/parseBase.ts:6` (123), `plugin/calendar/batch.ts:6` (119), `plugin/bridge/wa-to-tg/album-send.ts:14` (118), `util/proto.ts:282` (114), `plugin/bridge/wa-to-tg/send-media.ts:29` (114), and 73 more (full list in the sub-agent output).

### 6.5 `any` usage / unchecked casts (86 cast sites + pervasive `: any`/`any[]`)
Representative: `plugin/authState.ts:25,78`; `plugin/cache.ts:51,88,91`; `plugin/menuScraping.ts:86`; `plugin/runCode.ts:75`; `plugin/sticker/pool.ts:108`; `plugin/sticker/worker.ts:45`; `plugin/bridge/wa-to-tg/*` (secret-edits, jid, unsupported-preview, profile, rich, reaction-summary, relay, album-send, edits, send-media, unsupported, incoming, contact-names, media, deletes, special, text); `plugin/bridge/tg-to-wa/*` (group-members, media, handlers); plus `util/proto.ts` monkeypatch. Full grep saved to `/tmp/opencode/casts.txt`.

### 6.6 `console.*` in runtime code (126 calls)
Offending files: `plugin/calendarParser.ts`, most `plugin/bridge/wa-to-tg/*` and `plugin/bridge/tg-to-wa/*`, `plugin/bridge/mod.ts`, `plugin/bridge/db.ts`, `plugin/bridge/rate-limiter.ts`, `plugin/db.ts`, `event/messages/upsert.ts`, `event/connection/update.ts`, `class/baileys.ts`, `wa.ts`. Setup/scripts legitimately use `console.*`.

### 6.7 Architectural boundary bypass
- Direct SQL from a command: `cmd/dev/ping.ts:23-25` runs `db.select().from(users)...` inside a command (should go through `plugin/db.ts`).
- Bridge writes to WA via `bot.sock.sendMessage` directly in `tg-to-wa/handler-events.ts:34,70,152`, `coalesce.ts:122`, `album.ts:75`, `handlers.ts:160,195` (bridge-internal, but bypasses `msgAbstractions`; flag for review).
- No direct `sock.sendMessage` from commands.

### 6.8 Hard-coded catalogs / counts / fixed layouts
- `setup/env.ts:22` hard-codes `['pt','en','es','fr','de']` instead of deriving from `locale/*.json`.
- `plugin/bridge/wa-to-tg/unsupported-preview.ts:31-32` fixed `slice(0, 5)` option preview.
- `plugin/bridge/wa-to-tg/reaction-summary.ts:109` fixed `MAX_NAMES` truncation.
- `plugin/bridge/wa-to-tg/poll-tally.ts:203` fixed `votes.slice(0, 10)`.
- Bucket lanes hard-coded to `'personal'/'business'` (intentional two-lane design, but type unions duplicated across `db.ts`, `routing.ts`, `buckets.ts`).

### 6.9 Em dashes / en dashes
- `docs/transcrypt-plan.md` uses `—` (em dash).
- `plugin/calendar/blocks.ts:29` and `plugin/calendar/parseResolution.ts:22,73` use `–` (en dash) in regex char classes (intentional separator matching; still a literal en dash in code).

### 6.10 File naming (kebab-case, no abbreviations)
Non-compliant (excluding legacy `util/` camelCase explicitly allowed to remain): `class/groupMeta.ts`, `plugin/authState.ts`, `plugin/calendar/parseBase.ts`, `plugin/calendar/parseResolution.ts`, `plugin/calendarParser.ts`, `plugin/deletedStore.ts`, `plugin/groupAnnouncer.ts`, `plugin/menuScraping.ts`, `plugin/runCode.ts`, `scripts/bridge_alias_cleanup.ts`, `scripts/bridge_buckets.ts`, `scripts/bridge_jid_check.ts`, `scripts/coalesce_smoke.ts`, `scripts/dump_calendar.ts`, `scripts/outbox_smoke.ts`. (`conf/types/*.d.ts` and `util/*` legacy names exempt.)

### 6.11 Modules mixing unrelated responsibilities
- `plugin/bridge/db.ts` (958 lines): schema, migrations, pairing, reply map, echo guards, all queries.
- `plugin/bridge/wa-to-tg/reaction-summary.ts` (753 lines): relay, inline mirrors, tally, button handlers.
- `plugin/bridge/tg-to-wa/group-menu.ts` (484 lines): menu UI, member chat, move.
- `util/proto.ts` (395 lines): console monkeypatch + prototype helpers + libsignal throttling.
- `plugin/menuScraping.ts`: scraping + menu send + calendar cache.

### 6.12 Missing `// SECURITY:` / `// PRIVACY:` markers
None present anywhere. Recommended addition sites: `class/cmd.ts` (`checkPerms`), `event/messages/upsert.ts` (inbound parse/filter), `cmd/dev/eval.ts` and `cmd/dev/execute.ts` (restrict + code execution), `cmd/util/clean.ts` and `cmd/util/gotcha.ts` (ownership/deletion), `plugin/deletedStore.ts` (recovery cache holds deleted content), `plugin/cache.ts` (caps/eviction), `plugin/memories.ts` (personal data), `plugin/authState.ts` (auth material), `plugin/bridge/db.ts` (pairing/reply-map scoping), `plugin/bridge/tg-to-wa/*.ts` (topic guards).

### 6.13 Commented-out code
`util/geminiApi.ts:41,72,74,86-89` (commented `createAlarms`, tool toggles, alarm model). No TODO/FIXME/XXX present (none to format).

### 6.14 Secrets in code
None found (all via `Deno.env.get`).

### 6.15 Path traversal risks
- `plugin/runCode.ts:52-54` writes to `${tempFolder}/exec.${ext}` from fixed config; lang/ext derived from `defaults.runner` (not user path). Low risk. `file` param path used directly if provided by dev command (`restrict: true`). Flag for review if non-dev reachable (it is not).

### 6.16 Generated files committed
- `conf/gen/disabled/alarms.ts.disabled` is tracked despite `.gitignore` covering `conf/gen/*`. Should be removed from history or moved to `scripts/`/`docs/`.

### 6.17 O(N²) note
Not re-audited here; likely hotspots: `util/menuParser.ts`, `plugin/bridge/wa-to-tg/reaction-summary.ts` grouping, `plugin/bridge/wa-to-tg/poll-tally.ts` voter scans. Recommend targeted review if scale issues arise.

## 7. Verification performed

- `deno check` — clean (148 files).
- `deno lint` — clean (148 files).
- `deno fmt --check` — 1 unformatted file (`docs/transcrypt-plan.md`).
- No test suite committed; no tests run.
- No code modified.

---

## 8. Limitations

- This audit is static; no runtime profiling, RSS measurement, or load testing was performed (per agents.md, those require a live smoke, which was not run).
- Import-order compliance was not fully verified across all files (no automated check available).
- Security/privacy deep-dive on every permission gate was not exhaustive; markers and gate presence were spot-checked only.
- The compliance deep-dive is detailed in section 6 (sub-agent pass). Function-length enumeration is summarized at the top-offender level; the full 88-site list is in the sub-agent output.

---

*End of report.*
