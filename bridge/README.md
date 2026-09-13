# Telegram Bridge Bot - README

## Overview

Two Telegram supergroups (forum topics enabled) — personal and business, served by one bot — mirror
WhatsApp chats, so you can read and reply to WhatsApp from Telegram. Each WhatsApp chat (1:1 or
group) maps to one forum topic in its bucket's group. New chats land in personal as undecided until
you tap **👤 Personal** / **💼 Business** on the prompt (or run `/personal` / `/business` in the
topic); business moves start clean, personal moves replay up to 100 recent messages.

## Architecture (single process)

The bridge runs **embedded in the WhatsApp bot process** (`wa.ts` calls `startBridge()` after
`bot.connect()` + `loadEvents()`). It reuses the already connected Baileys socket — there is
intentionally **no second WhatsApp connection**, because two sockets sharing one auth state kick
each other off (stream conflict / repeated logouts). That was the failure of the previous standalone
approach.

- **WhatsApp → Telegram** (`wa-to-tg.ts`): extra `messages.upsert` listener on the shared socket.
  Looks up `whatsapp_jid → topic`, auto-creates the forum topic on first sight, relays text + media
  via the proper `sendPhoto` / `sendVideo` / `sendVoice` / `sendDocument` / `sendSticker` calls.
- **Telegram → WhatsApp** (`tg-to-wa.ts`): grammY handlers relay topic messages back out through
  `bot.sock.sendMessage`. Telegram replies become WhatsApp quoted replies via the `reply_map` table,
  reactions become WA reacts, edits become protocol MESSAGE_EDITs, and `/new <phone> [name]` starts
  a bridged chat from the Telegram side.
- **Mapping store** (`db.ts`): SQLite at `conf/gen/bridge.db` —
  `mappings(whatsapp_jid ↔ telegram_topic_id, telegram_chat_id, bucket, …)` + `reply_map` keyed by
  `(tg_chat_id, tg_msg_id)` + `jid_aliases` for LID/PN variants.
- **Rate limiting** (`rate-limiter.ts`): one global FIFO queue for **Telegram** API calls (shared
  across both groups, so stricter than either group's budget), plus a separate light queue for
  WhatsApp sends. Every `tg.api.*` call is its own queue slot with ~3s spacing; on a 429 the failing
  send is retried after the server's `retry_after` and the whole queue pauses — no more 429 cascades
  or silent drops.

## Telegram Bot Setup Steps

1. `/newbot` with @BotFather → token.
2. Create two supergroups (personal + business), enable **Topics** (Forum) in each.
3. Add the bot to both, make it **admin** with `can_manage_topics` in each.
4. Send any message in a group, then discover its ID (repeat per group):
   ```bash
   deno run -A --env-file=conf/.env bridge/mod.ts -- --find-id
   ```
5. Put the values in `conf/.env` (NOT `bridge/.env` — the bot loads `conf/.env`):
   ```env
   TELEGRAM_BOT_TOKEN='your-bot-token'
   TELEGRAM_SUPERGROUP_PERSONAL='-1001111111111'
   TELEGRAM_SUPERGROUP_BUSINESS='-1002222222222'
   # Legacy single-group setups: both fall back to TELEGRAM_SUPERGROUP_ID.
   # Optional flood-control tuning (defaults shown):
   TELEGRAM_RATE_LIMIT_MS=3000   # spacing between Telegram sends (legacy name: RATE_LIMIT_MS)
   WHATSAPP_RATE_LIMIT_MS=500    # spacing between WhatsApp sends
   RATE_LIMIT_MAX_RETRIES=5      # retries per send after a 429 before dropping it
   RATE_LIMIT_MAX_WAIT_MS=120000 # cap for a single flood wait
   ```

## Running

Just run the WhatsApp bot as usual — the bridge starts with it when the env vars above are set, and
stays silent otherwise:

```bash
deno task start:dev   # or: pm2 start conf/ecosystem.config.cjs --attach
```

## Commands (inside either supergroup)

- `/start` — bridge status
- `/id` — show this supergroup's chat ID
- `/topics` — list active JID → topic mappings (with bucket)
- `/personal` / `/business` — move this topic to the other group (same as the prompt buttons)
- `/archive` / `/close` — stop mirroring a topic (mapping kept)
- `/reopen` — resume mirroring an archived topic
- `/mute` / `/unmute` — freeze/resume relay in both directions for this topic (mapping kept)
- `/new <phone> [name]` — verify a number on WhatsApp and bridge it into a fresh topic (inherits the
  group you run it in, no prompt)

## Known Limitations

- Own WhatsApp messages sent from the phone mirror with a `You:` label; TG→WA echoes are
  deduplicated through `reply_map`.
- Edits relay both ways (text in place, media via caption fallback); mirrors of
  stickers/polls/venues/contacts are skipped (not bot-editable), TG-initiated edit echoes are
  deduplicated, and failures log at debug/warn level instead of erroring. Outside the platform edit
  windows (TG 48h, WA ~15 min) edits can't apply.
- Formatting (bold/italic/strike/code) converts both ways; underline/spoiler and named links degrade
  gracefully.
- WhatsApp @mentions cross as `@name (+phone)` (Telegram can't resolve WA identities; LID and
  non-phone JIDs pass through unannotated). Applies to new messages and WA-side edits.
- Reactions are last-writer-wins per message (single bot identity on each side); common WhatsApp
  reactions missing on Telegram (😂→🤣, …) are mapped, anything Telegram rejects (REACTION_INVALID)
  falls back to a default ❤️ (with a one-time warn); custom-emoji and paid TG reactions fall back to
  ❤️ on WhatsApp. Two prerequisites, both silent when missing: the bot must be an **administrator**
  of the supergroup and polling must opt into `message_reaction` (done in `mod.ts` — Telegram
  excludes it from defaults). TG-initiated react echoes are deduplicated via a pending mark, so
  genuine reactions from your own phone still relay; WA reaction carriers never surface as `You: ❤️`
  text.
- Deletes sync WA→TG as a spoiler tombstone: the mirror is re-edited to `🗑️ Deleted on
  WhatsApp`
  plus the original content hidden behind a spoiler (text in place, media via caption; repeat
  revokes are idempotent). Mirrors without stored content (stickers, specials, old rows) are still
  deleted instead — needs delete rights in the supergroup; old/gone mirrors just log. TG→WA delete
  sync is impossible — the Bot API emits no event when a Telegram message is deleted.
- WhatsApp quotes of never-bridged originals render as a real Telegram quote block (blockquote
  entity) instead of plain `↩️` text; mapped originals still use native replies. Quotes of pre-move
  messages left behind in the other group also degrade to the header (a numeric ID from another
  group would misattach).
- Topic moves (`/personal` / `/business` / prompt buttons) serialize per chat — a double-tap never
  opens two topics. Moving to business starts a fresh topic (history stays readable in the old,
  closed topic); moving to personal replays up to 100 recent messages with reply threading.
- Albums: rapid WA photo/video bursts from one sender cross as a single Telegram media group (1.5s
  batching window, so single photos arrive ~1.5s later; extra captions follow as text); TG albums
  (`media_group_id`) forward in order over a 1.2s window (Baileys has no album-send, so WA receives
  ordered singles).
- Round video notes stay round both ways (`sendVideoNote` / `ptv`, plain-video fallback); GIFs cross
  as GIFs (`sendAnimation` / `gifPlayback`). Telegram video stickers transcode to animated WebP via
  ffmpeg (≤500KB, else video fallback); `.tgs` (Lottie) still relays as a document — ffmpeg can't
  render it.
- Relay failures post a specific ⚠️ notice to the affected topic: failed downloads name the
  attachment kind and size (documents include the file name), Telegram files over the 20 MB bot
  download limit are skipped up front with a notice naming the cap, and album failures say which
  item (`item 3 of 5`) or how many photos stalled. The notice itself never throws or loops.
- Polls cross natively both ways with live vote sync: WA creation mirrors as a non-anonymous TG poll
  (every payload version, option images unwrapped to text), TG-created polls become native WA polls,
  and votes on either side decrypt/encrypt into the other via the `reply_map` poll metadata (see
  `plan.md` §6), with a live tally message (counts, percentages, voters). Sent TG polls can't be
  re-edited and WA poll payloads are immutable, so close/stop isn't mirrored.
- Group joins/leaves/admin changes post service lines; renames also rename the topic.
- `General`-topic messages (no `message_thread_id`) are ignored except commands.
- Captions over 1024 chars arrive as media + follow-up text message.
- WhatsApp `view-once` media is relayed after unwrapping (privacy note: it becomes a normal Telegram
  message).
- Status/broadcast/newsletter JIDs are ignored by the socket already.
- If the WhatsApp socket reconnects, the bridge hook persists (same process).
