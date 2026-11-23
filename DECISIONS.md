# Decisions

Append-only ADRs. Reference from code as `// See DECISIONS.md#D01`.

## D01 - Telegram bridge as a bot plugin (2026-10-08)

Decision: relay logic stays in `bridge/`; bot owns lifecycle via `plugin/bridge.ts`, used only by
`wa.ts`, `event/connection/update.ts`, `cmd/dev/memory.ts`. Reason: same ownership boundary with far
less churn than moving `bridge/` under `plugin/`. Consequences: `bridge/mod.ts` gains `stopBridge()`
for SIGINT/SIGTERM.

## D02 - Bridge tree lives under plugin/ (2026-10-08)

Supersedes the D01 layout note. Decision: move the whole `bridge/` tree to `plugin/bridge/`;
`plugin/bridge.ts` stays the lifecycle facade, so callers need no changes. Reason: owner direction.
Consequences: pure rename; path fixes followed in the next commit.

## D03 - Unpinned dependency ranges (2026-10-08)

Decision: import maps use caret ranges; lockfiles stay exact. Reason: compatible updates flow
without a manual bump per release. Consequences: no blanket majors; docs point at import maps as the
range source.

## D04 - Pinned WA profile card per bridge topic (2026-10-08)

Decision: new topics open with a pinned profile card (photo plus about); picture changes re-send and
re-pin; a hidden photo degrades to a text-only card; no backfill for pre-existing mappings. Reason:
richer topic identity with minimal storage and no failure on missing photos. Consequences: three
safe-ADD `mappings` columns; pic URLs stay local-only and are never logged; needs bot pin rights in
the supergroup.

## D05 - Classification buttons on the profile card, business wipes (2026-10-08)

Decision: Personal/Business buttons ride on the pinned card sent once per new topic; Business wipes
the old topic and opens a fresh one. Reason: the standalone prompt had no in-flight lock, so
concurrent upserts posted duplicate prompts. Consequences: duplicates structurally impossible;
cleanup uses a droppable `cleanup` queue.

## D06 - Learned @Name mention rendering (2026-10-08)

Decision: relayed group messages teach a speaker directory; numeric mention tokens render as
`@Name`; the owner's address book is never read. Reason: bare-number tokens relayed poorly because
the bridge knew no member names. Consequences: `contact_names` table (LRU 2000) plus a 500-entry
cache; output stays plain text (no false pings).

## D07 - Silent group joins/exits (2026-10-08)

Decision: join/exit lines relay with `disable_notification`; promote/demote lines still notify.
Reason: owner direction; silence means no ping, not gone.

## D08 - Group settings menu with member browser (2026-10-08)

Decision: `/group` opens one in-place menu (paged roster, search, member card); search arms a 60s
intercept. Reason: avoid per-member message spam on large rosters. Consequences: needs bot delete
rights for the search intercept.

## D09 - Merged WA reaction footer with viewer button (2026-10-09, updated 2026-10-20)

Decision: track reactions by author; render a compact footer in the mirror with an `rx:<mirrorId>`
viewer button; native Telegram reactions no longer set; `BRIDGE_REACTION_SUMMARY` retired (no-op for
compat). Reason: Telegram allows one native reaction per message and rejects many WhatsApp emojis.
Consequences: roster stored as JSON on the `reply_map` row (100 voters / 20 emojis), pruning with
the row after 7 days; no retention widening.

## D10 - Tap-to-vote poll buttons with voter viewer (2026-10-09)

Decision: counts-only tally with tap-to-vote buttons and a viewer button; taps toggle on multi,
replace on single. Reason: Telegram polls cannot be edited, so the tally reply is the vote surface.
Consequences: multi captured at mirror time; no new retention.

## D11 - Burst joining for relay texts and service events (2026-10-09)

Decision: three in-memory buffers join rapid bursts (WA-to-TG text coalesce, service-event batch,
TG-to-WA text coalesce). Reason: rapid bursts cost one send per message and sprayed N sends through
paced queues. Consequences: a joined WA-to-TG batch keeps one `reply_map` row, so only the first WA
id resolves for later quotes, edits and deletes.

## D12 - Durable outbox for queue-shed payloads (2026-10-20)

Decision: queue drops park the original WA message in `wa_outbox` (protobuf BLOB); a worker replays
oldest-first; rows expire after 24h. Reason: the bounded Telegram queue used to lose payload
messages on sustained bursts. Consequences: replay may duplicate a part after a partial send;
preferable to silent loss.

## D13 - Quoted-media sticker resolution uses the real Baileys key (2026-11-09)

Decision: `getMedia()` derives the raw Baileys key (`imageMessage`/`videoMessage`/...) from stored
content via `getMsgType`; quoted keys are stored keys-only so bytes fetch on demand. Reason: the old
literal `'media'` key never matched, so `.s` on a quoted image/video fell through to batch/usage.
Consequences: quoted stickers still reveal as plain images; no-media input still shows
`usage.sticker`.

## D14 - Bridge bucket split-brain heal and LID/PN duplicate merge (2026-11-09)

Decision: repoint split-brain rows to the hosting group before classification; boot reconcile folds
a duplicate LID/PN pair onto the newest topic (replies repointed, loser JID aliased, loser row
archived); `canonicalChatJid` negative-caches unresolved LID for 15s; `ensureTopicMapping` locks
keyed by every known variant; `getByJidOrAlias` lets an archived row yield to an active alias.
Reason: the mapping row could disagree with the group hosting its topic, and LID/PN sightings could
race into two mappings. Consequences: no Telegram messages or topics are deleted; bucket and mute
state carry over; PN rows are never downgraded to LID.
