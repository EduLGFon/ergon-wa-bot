# Decisions

Append-only architecture decision records. Newest at the bottom. Reference from code as
`// See DECISIONS.md#D01`.

## D01 - Telegram bridge as a bot plugin (2026-10-08)

The relay logic stays in `bridge/` (own deno.jsonc scope, one module per concern) and the bot owns
its lifecycle through `plugin/bridge.ts`, the only entry `wa.ts`, `event/connection/update.ts` and
`cmd/dev/memory.ts` use. Chosen over moving `bridge/` under `plugin/`: same ownership boundary with
a fraction of the churn (no import rewrites across 40+ modules, no alias or tooling changes).
`bridge/mod.ts` gains `stopBridge()` so SIGINT/SIGTERM stops grammy polling and closes the SQLite
handle; previously `onExit` only flushed cache and stickers.

## D02 - Bridge tree lives under plugin/ (2026-10-08)

Supersedes the D01 layout note: per owner direction the whole `bridge/` tree moved to
`plugin/bridge/` (facades plus `wa-to-tg/` and `tg-to-wa/` module dirs, scope config, lockfile and
docs). `plugin/bridge.ts` stays beside it as the lifecycle facade, so `wa.ts`,
`event/connection/update.ts` and `cmd/dev/memory.ts` needed no changes for this move. Pure rename
landed alone; path fixes (scope config, `--find-id` help strings, scripts, setup prompts, docs)
followed in the next commit. `agents.md` path references were updated in the working tree but left
uncommitted next to the prior pending hunk for owner review.

## D03 - Unpinned dependency ranges (2026-10-08)

Import maps use caret ranges instead of exact pins (for example `npm:grammy@^1.46.0`), so compatible
updates flow on fresh installs without a manual bump per release. Ranges still exclude majors (and
minors on 0.x packages); both `deno.lock` files stay committed and exact, and blanket major upgrades
remain forbidden without review. Docs and `agents.md` name packages without versions and point at
the import maps as the range source.

## D04 - Pinned WA profile card per bridge topic (2026-10-08)

Each new bridge topic opens with a pinned profile card: the WA profile photo (DM avatar or group
icon via `profilePictureUrl(..., 'image')`) plus the about/status text (DMs via `fetchStatus`,
groups via `groupMetadata.desc`), sent through the normal flood queue and pinned with
`pinChatMessage`. Picture changes arrive as `contacts.update` with `imgUrl` changed/removed (Baileys
emits this for both DMs and groups); the handler re-sends the card, unpins the previous card message
(kept as history, never deleted) and pins the fresh one. About text has no push event, so it is a
snapshot at each card send. A hidden photo degrades to a text-only card, never a failure. Only new
topics get cards plus later change events: pre-existing mappings get no backfill. Storage is three
safe-ADD `mappings` columns (`profile_pic_url`, `profile_about`, `profile_msg_id`) holding the last
seen state plus the card message id for unpin; pic URLs may carry tokens, so they live only in the
local bridge DB (same trust level as `reply_map` content) and are never logged. Needs the bot to
have pin rights in the supergroup (same prerequisite as WA pin sync, already warned at boot).
Verified: `deno task verify` chain only (no live WA/TG smoke in this environment).

## D05 - Classification buttons on the profile card, business wipes (2026-10-08)

The standalone new-chat prompt is gone: it had no in-flight lock, so concurrent upserts each posted
one (two or more prompts per chat, every stale pair answering chat not found because only the latest
id was stored). The Personal/Business buttons now ride on the pinned profile card itself, which is
sent exactly once per new topic via the `isNew` flag, so duplicates are structurally impossible.
Taps resolve through `mappings` matching `prompt_msg_id` or `profile_msg_id` (legacy prompts keep
working until used). Tapping Personal in the home group just strips the keyboard; tapping Business
wipes the old topic (best-effort deletes of known messages, capped at 50, then `deleteForumTopic`,
no pointer and no confirm per owner direction), opens a fresh business topic with a buttonless
profile card plus a summary line. Personal moves are unchanged (replay plus pointer). Cleanup
deletes use a new droppable `cleanup` queue label so a wipe never stalls relay. Verified:
`deno task verify` chain only (no live WA/TG smoke in this environment).

## D06 - Learned @Name mention rendering (2026-10-08)

Bare-number mention tokens (`@1234567890`) relayed terribly because the bridge knew no member names.
Every relayed group message now teaches a speaker directory (participant JID to pushName); mentions
pairing a numeric token with a known JID render as `@Name`, readable tokens keep the sender's
wording. Learned only per owner direction: the owner's address book (`contacts.upsert`, history-sync
contacts) is never read. Storage is a new `contact_names` table (jid PK, name, updated_at,
LRU-capped at 2000 rows) plus a 500-entry memory cache, so per-message cost is one Map lookup and
SQLite is written only on new or changed names. Lookups try the normalized JID plus its LID/PN
counterpart via the Baileys signal store. Output stays plain text (no Telegram entities), so nobody
gets false-pinged; owner-ping spans are recomputed after replacement. Same contract in `incoming.ts`
and `edits.ts`. Verified: `deno task verify` chain only (no live WA/TG smoke in this environment).

## D07 - Silent group joins/exits (2026-10-08)

Join/exit service lines relay with `disable_notification` per owner direction (visible in the topic,
never pinging); promote/demote lines still notify normally. First landed as a drop, then corrected:
silence means no ping, not gone. Verified: `deno task verify` chain only (no live WA/TG smoke in
this environment).

## D08 - Group settings menu with member browser (2026-10-08)

`/group` in a group topic opens one menu message edited in place (menu, paged member list, search
results, member card), so 1000+ rosters cost a single message: one WA `groupMetadata` fetch cached
60s, pages of 8, tiny callback payloads (`gm:<tok>:<op>:<arg>`, JIDs stay server-side in capped
15min sessions), in-memory search filter. Search arms a 60s intercept: the user's next typed
non-command message in the topic is consumed and deleted instead of relaying to WhatsApp (needs bot
delete rights; without them the query stays visible but search still runs). Member card offers
start-chat mirroring `/new` (verify, topic in the same group, mapping, profile card, duplicate
guard). Menu also toggles mute and personal/business moves (business wipes per D05). Verified:
`deno task verify` chain only (no live WA/TG smoke in this environment).

## D09 - Merged WA reaction footer with viewer button (2026-10-09)

Telegram bots get one native reaction per message and reject many WhatsApp emojis, so the old
last-writer-wins mirror showed a single mapped emoji and dropped the rest. Every WA reaction now
tracks by author from the upsert carriers (the `messages.reaction` event carries no author, so its
listener is gone) and renders a compact footer inside the mirror itself (`heart 2  thumbsup 1`,
original WA emojis verbatim, nothing mapped away) with a stateless `rx:<mirrorId>` button that
reveals who reacted on each emoji (short rosters as an alert, long ones as a topic reply). Native
Telegram reactions are intentionally no longer set: Telegram rejects many WA emojis, the footer
already preserves every original, and each native attempt cost an API slot. (2026-10-20 update:
removed the best-effort call and its `REACTION_INVALID` heart retry; the footer is the sole
display.) Roster persists as JSON on the `reply_map` row (`wa_reactions`: per-author name plus emoji
plus timestamp, capped at 100 voters and 20 emojis, plus the fallback line id), so it survives
restarts and prunes with the row after 7 days - no retention widening; reactor names are the same
display names already relayed in message labels. Editable mirrors (text, short media captions) carry
the footer in place; stickers, polls and long texts keep a compact reply line instead. WA text edits
refresh the stored base and re-apply the footer; deletes clear the roster, line and button with the
mirror. `BRIDGE_REACTION_SUMMARY` is retired (always-on behavior, env key kept as a no-op for
compat). Verified: `deno task verify` chain only (no live WA/TG smoke in this environment).

## D10 - Tap-to-vote poll buttons with voter viewer (2026-10-09)

Same UX as the D09 reaction footer, adapted to polls (TG polls cannot be edited, so the tally reply
is the vote content). The tally is now counts-only with one tap-to-vote button per option (ticked on
the owner's picks) plus a viewer button showing who voted what (alert when short, topic reply when
long). A tap rebuilds the encrypted selection and sends it like a native TG poll answer; the tally
refreshes when the WA echo lands (idempotent, no echo guard needed). Taps toggle on multi polls and
replace on single ones; clearing a whole vote or re-tapping a single pick only toasts, because the
vote builder requires a non-empty selection. The owner matches by bare account JID, stable since own
votes always echo with fromMe. Multi is captured at mirror time (`selectableCount > 1`), stored in
the poll meta (old bare-array rows still read), and the TG mirror is now multi-answer when WA is. No
new retention: the roster already lived on the reply_map row and the same voter names moved from
inline to behind the button. Verified: `deno task verify` chain plus a targeted poll-logic smoke
(option parsing both shapes, toggle/replace selection math, tally and viewer rendering); no live
WA/TG smoke in this environment.

## D11 - Burst joining for relay texts and service events (2026-10-09)

Rapid bursts used to cost one Telegram/WhatsApp send per message: a fast typist, a reconnect
backlog, or a mass invite sprayed N sends (N slots, N notifications) through the paced flood queues.
Three small buffers now join them, all in-memory only (same trust level as the existing album
buffers, no schema or retention change):

- WA-to-TG `wa-to-tg/coalesce.ts`: text-only messages from the same sender in the same chat wait out
  a short sliding window (base 1800ms, `BRIDGE_COALESCE_MS`) and cross as one body (one sender
  label, parts joined by newline, entities and owner-mention spans rebased). The window stretches to
  4s/6s while the lane pressure (queued plus parked) passes 20/100, so a burst that would arrive
  late anyway arrives joined instead. Caps at 5 parts (`BRIDGE_COALESCE_MAX`) and 3500 chars.
- WA-to-TG `wa-to-tg/service-batch.ts`: `group-participants.update` events batch per chat over 3s
  (`BRIDGE_SERVICE_BATCH_MS`, same pressure stretch) into one service line (`joined` / `left` /
  `promote` / `demote` lines joined by newline), silent unless the batch holds an admin change. Same
  `service-line` shed label, so deep backlogs still drop these first.
- TG-to-WA `tg-to-wa/coalesce.ts`: plain texts from the same author in the same topic join over 1.5s
  (`BRIDGE_TG_COALESCE_MS`) into one WA send. Every TG id keeps its own reply_map row (same WA id),
  so TG-side edits and replies of any part still resolve. Media, polls, contacts, locations,
  replies, quoted messages and commands flush any pending burst first and always send alone, so chat
  order is preserved in both directions. Trade-off (WA-to-TG only): one Telegram message keeps one
  reply_map row, so only the first WA id of a joined batch resolves for later WA quotes, edits and
  deletes; follow-ups degrade to the existing unmapped fallbacks (header instead of native reply, no
  tombstone). Chosen over per-part rows because the reply_map primary key is one row per Telegram
  message. Verified: `deno task
verify` chain only (no live WA/TG smoke in this environment).

## D12 - Durable outbox for queue-shed payloads (2026-10-20)

The Telegram queue is deliberately bounded (500 slots at ~3s spacing, parked producers wait 60s), so
a sustained WA burst used to lose payload messages after the wait expired - 222+ operations in the
October logs, including text, photos, documents and voice notes. Sends that reject with a queue drop
now park the original WA message in `wa_outbox` as a protobuf-encoded `WebMessageInfo` BLOB, then
return without a topic notice (which would also be dropped). A worker replays rows oldest-first
every 15s once both Telegram lanes are below 100 queued calls, routing them through the normal
incoming pipeline so mapping, dedupe, media re-download and edit/quote fallbacks behave like fresh
traffic. Rows expire after 24h; queue pressure defers instead of counting as a failure, while
decode/replay errors retry three times. Media bytes are not stored, so replay re-downloads from the
original URL (and posts the usual download-failure notice if it has expired). Trade-offs: a drop
that occurs after a multi-call message's first API call can replay the already-sent part, and a
shutdown between send and row deletion can duplicate one message; both are preferable to silent
loss. Coalesced text batches and album items are parked per original WA message before their
in-memory timer fires, so they re-enter the normal batching path on replay. Verified:
`scripts/outbox_smoke.ts` (real DB + worker + fake Telegram API) plus the full `coalesce_smoke.ts`;
no live WA/TG smoke.
