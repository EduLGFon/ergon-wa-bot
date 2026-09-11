# Plan - Common WhatsApp message types on Telegram

Bridge parity work: reactions, emoji coverage, mentions, calls, pins, polls, rich types. Single
Telegram user (the owner), so multi-voter identity on the WA side is a non-issue.

Conventions: hyphens only (no em/en dashes), files ~150 lines, header comment on every file, imports
sorted descending by line length, `deno check` + `deno lint` + `deno fmt` after changes, atomic
Conventional Commits, update `docs/ARCHITECTURE.md` in the same commit when behavior it describes
changes.

## 1. Reaction emoji expansion - `bridge/wa-to-tg/reactions.ts`

Expand `WA_TO_TG_REACTION_FALLBACK` (~20 to ~40+ entries) with common WA reaction emojis missing
from Telegram's allowed set plus composite sequences. Purely additive table change, no logic
changes. Low risk, first to land.

## 2. @all / @mention owner notification - CRITICAL

Today `annotateMentions` (`bridge/wa-to-tg/text.ts`) only appends phones textually - no Telegram
entities, no notification.

- Detect: individual mentions via `contextInfo.mentionedJid` matching the owner's WA JID
  (`bot.sock.user.id`, PN + LID normalized); @all via `contextInfo.nonJidMentions > 0` (Baileys
  `Utils/messages.js` sets this flag for `mentionAll`).
- Owner TG identity: `TELEGRAM_OWNER_ID` env var overrides; fallback resolves
  `getChatAdministrators(personalSupergroup)` creator once at boot, cached in relay ctx.
- Mechanism: `annotateMentions` returns `{ text, ownerSpans[] }`; `dispatch.ts` and `edits.ts` merge
  `text_mention` entities (owner user object) with the markdown-derived entities (sorted,
  offset-shifted, deduped). @all marks the first `@Token`. Covers text, captions, albums, edits.

## 3. Pin sync both directions - NEW

Status today: no sync. WA `pinInChatMessage` hits the unsupported notice; TG `pinned_message`
service messages are silently dropped (`handlers.ts` early return).

- WA to TG: new `bridge/wa-to-tg/pins.ts`. Intercept `pinInChatMessage` in the upsert path before
  `notifyEmptyRelay`, resolve the mirror via `reply_map` (`key.id`), then `pinChatMessage` (type 1 =
  PIN_FOR_ALL) or `unpinChatMessage` (type 2 = UNPIN_FOR_ALL). Requires bot `can_pin_messages`.
- TG to WA: detect `msg.pinned_message` in `registerTgMessageHandler`, look up the WA key via reply
  map, `bot.sock.sendMessage(jid, { pin: key, type: 1,
  time: 30d })`. Baileys builds
  `pinInChatMessage` from `{ pin, type }` (`Utils/messages.js`).
- Asymmetry: TG to WA _unpin_ is undetectable (Bot API emits no unpin update, same class as TG
  delete sync). Document it.
- Echo guards: `markTgPin`/`takeTgPin` in `db.ts` mirroring `markTgReact`/`takeTgReact` (TG pin uses
  `disable_notification: true` so no service echo, but guard the WA echo all the same).

## 4. Call notifications - new `bridge/wa-to-tg/calls.ts`

Listen to the Baileys `call` event (`WACallEvent`: chatId/from/callerPn,
isVideo/isGroup/status/offline) in `relay.ts`. Coalesce each call id into one editable notification:
incoming -> ringing -> in progress (elapsed) -> ended (duration) / missed (reject/timeout) /
offline. Author: callerPn, then group-metadata name, then phone. Skip unmapped chats. Durations from
startedAt/terminate. Single status lines, no grouping window needed beyond the call id map.

## 5. Other message types as text notices

Replace generic "didn't cross" lines with useful content (`rich.ts`, wired in `incoming.ts` before
the empty-relay branch): `contactsArrayMessage` -> contact list text; `groupInviteMessage`,
`eventMessage`/`eventResponseMessage`, `scheduledCallCreationMessage`, `stickerPackMessage` ->
formatted notices; `callLogMessage` -> text unless it duplicates a just-relayed live call
(suppressed via `wasCallClosedRecently`, 120s window). Handled types leave
`WA_UNSUPPORTED_FRIENDLY`.

## 6. Polls - creation, votes, results

- `pollCreationMessageV3` in `getSpecialContent` (`special.ts`), same as V1.
- Persist at mirror time (new `reply_map` columns, safe-ADD migration in `db.ts`): `wa_poll_secret`
  (`messageContextInfo.messageSecret`), `wa_poll_options` (ordered names, JSON), `wa_poll_creator`,
  `tg_poll_id`.
- WA to TG votes: `bridge/wa-to-tg/polls.ts`, decrypt upsert `pollUpdateMessage` via Baileys
  `decryptPollVote`, map hashes to names, notify `voted: Option B`. `pollResultSnapshotMessage`/V3
  -> results line.
- TG to WA votes: `registerTgPollAnswerHandler` + `poll_answer` in `allowed_updates`; map
  `option_ids` -> sha256(optionName) -> encrypt vote (AES-GCM, `decryptPollVote` scheme) ->
  `relayMessage` (Baileys `sendMessage` cannot send votes). Voter is the owner account - fine for
  one user. Echo guard like `markTgReact`.

## 7. Multiple reactions with authors - new `bridge/wa-to-tg/reaction-summary.ts`

`setMessageReaction` stays the most-popular emoji; a summary message
(`thumbsup Alice, Bob / heart Dave`) is edited per change, deleted when empty. Authors from the
`reactionMessage` upsert carrier (`pushName` -> group metadata -> phone, never bare LID). Name-first
rule also applies to poll vote and call author display. Env toggle `BRIDGE_REACTION_SUMMARY`.

## Order

1. Emoji expansion, 2. mentions, 3. pins, 4. calls, 5. rich types,
2. polls, 7. reaction summary.
