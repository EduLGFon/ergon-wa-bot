# Telegram Bridge Bot - README

## Overview

One Telegram supergroup (forum topics enabled) mirrors WhatsApp chats, so you can read and reply to
WhatsApp from Telegram. Each WhatsApp chat (1:1 or group) maps to one forum topic.

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
  `mappings(whatsapp_jid ↔ telegram_topic_id, …)` + `reply_map`.
- **Rate limiting** (`rate-limiter.ts`): one global FIFO queue with ~1s spacing, because all topics
  share the same supergroup chat (≈1 msg/sec limit).

## Telegram Bot Setup Steps

1. `/newbot` with @BotFather → token.
2. Create a supergroup, enable **Topics** (Forum) in group settings.
3. Add the bot, make it **admin** with `can_manage_topics`.
4. Send any message in the supergroup, then discover its ID:
   ```bash
   deno run -A --env-file=conf/.env bridge/mod.ts -- --find-id
   ```
5. Put the values in `conf/.env` (NOT `bridge/.env` — the bot loads `conf/.env`):
   ```env
   TELEGRAM_BOT_TOKEN='your-bot-token'
   TELEGRAM_SUPERGROUP_ID='-1001234567890'
   RATE_LIMIT_MS=1000
   ```

## Running

Just run the WhatsApp bot as usual — the bridge starts with it when the env vars above are set, and
stays silent otherwise:

```bash
deno task start:dev   # or: pm2 start conf/ecosystem.config.cjs --attach
```

## Commands (inside the supergroup)

- `/start` — bridge status
- `/id` — show this supergroup's chat ID
- `/topics` — list active JID → topic mappings
- `/archive` / `/close` — stop mirroring a topic (mapping kept)
- `/reopen` — resume mirroring an archived topic
- `/new <phone> [name]` — verify a number on WhatsApp and bridge it into a fresh topic

## Known Limitations

- Own WhatsApp messages sent from the phone mirror with a `You:` label; TG→WA echoes are
  deduplicated through `reply_map`.
- Edits relay both ways (text in place, media via caption fallback); mirrors of
  stickers/polls/venues/contacts are skipped (not bot-editable), TG-initiated edit echoes are
  deduplicated, and failures log at debug/warn level instead of erroring. Outside the platform edit
  windows (TG 48h, WA ~15 min) edits can't apply.
- Formatting (bold/italic/strike/code) converts both ways; underline/spoiler and named links degrade
  gracefully.
- Reactions are last-writer-wins per message (single bot identity on each side); common
  WhatsApp reactions missing on Telegram (😂→🤣, …) are mapped, anything Telegram rejects
  (REACTION_INVALID) is skipped with a one-time warn; custom-emoji and paid TG reactions
  fall back to ❤️ on WhatsApp.
- Group joins/leaves/admin changes post service lines; renames also rename the topic.
- `General`-topic messages (no `message_thread_id`) are ignored except commands.
- Captions over 1024 chars arrive as media + follow-up text message.
- WhatsApp `view-once` media is relayed after unwrapping (privacy note: it becomes a normal Telegram
  message).
- Status/broadcast/newsletter JIDs are ignored by the socket already.
- If the WhatsApp socket reconnects, the bridge hook persists (same process).
