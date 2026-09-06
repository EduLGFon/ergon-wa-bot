# Telegram Bridge Bot - README

## Overview

This bridge turns a single Telegram supergroup (with Forum Topics enabled) into a live mirror of
WhatsApp chats, allowing you to read and reply to WhatsApp from Telegram.

## Architecture

- **WhatsApp → Telegram**: Incoming WhatsApp messages are relayed to Telegram forum topics
- **Telegram → WhatsApp**: Telegram messages in forum topics are relayed back to WhatsApp
- **Mapping Store**: SQLite database (`conf/gen/bridge.db`) stores
  `whatsapp_jid ↔ telegram_topic_id` mappings
- **Rate Limiting**: Outgoing queue with ~1 message/sec limit per topic to respect Telegram limits

## Telegram Bot Setup Steps

1. **Create bot via BotFather**: `/newbot` on @BotFather
2. **Add bot to supergroup**: Make it an admin
3. **Enable Topics**: In supergroup settings, enable Forum Topics
4. **Grant permissions**: The bot needs `can_manage_topics` admin right
5. **Send a message** in the supergroup (so updates are available)
6. **Discover the supergroup ID**:
   ```bash
   cd bridge
   deno run -A --env-file=.env mod.ts -- --find-id
   ```
7. **Set environment variables** in `.env`:
   - `TELEGRAM_BOT_TOKEN` — Your bot token from BotFather
   - `TELEGRAM_SUPERGROUP_ID` — The ID printed by `--find-id`

## Environment Variables

```env
# Required
TELEGRAM_BOT_TOKEN='your-bot-token'
TELEGRAM_SUPERGROUP_ID='your-supergroup-id'

# Optional (reuse existing WhatsApp bot credentials)
DATABASE_URL='postgresql://user:pass@host/db'
RATE_LIMIT_MS=1000
```

## Running

```bash
# Discover supergroup ID first (if not known)
cd bridge
deno run -A --env-file=.env mod.ts -- --find-id

# Start the bridge
deno run -A --env-file=.env mod.ts
```

Or alongside the existing WhatsApp bot:

```bash
cd /home/ed/p/test-ergon
deno task start
cd bridge
deno run -A --env-file=.env mod.ts
```

## Commands

- `/start` — Bot status
- `/id` — Show the supergroup chat ID for `.env` configuration
- `/topics` — List all active topic mappings
- `/archive` — Archive a topic (preserves mapping/history)

## CLI Flags

- `--find-id` — Discover the supergroup ID by querying Telegram API updates. Requires the bot to be
  added to the supergroup and a message to have been sent there.
  ```bash
  deno run -A --env-file=.env mod.ts -- --find-id
  ```

## Known Limitations

- **Media**: Only basic media types are fully supported; complex media (albums, reactions) may not
  relay correctly
- **Quotes**: Telegram replies to WhatsApp quotes are not yet fully mapped
- **Group sender info**: WhatsApp group messages show sender name as prefix, but the mapping is
  per-JID not per-sender
- **Latency**: Media download/upload adds delay; text-only relay is faster
- **Connection**: The bridge creates its own WhatsApp connection using the same auth state; if the
  main bot reconnects, the bridge should also reconnect automatically

## File Structure

```
bridge/
├── mod.ts              # Main entry point
├── db.ts               # SQLite mapping store (schema + CRUD)
├── rate-limiter.ts     # Outgoing rate-limit queue with backoff
├── wa-to-tg.ts         # WhatsApp → Telegram relay
├── tg-to-wa.ts         # Telegram → WhatsApp relay
├── .env                # Configuration
├── .gitignore
└── deno.jsonc          # Project configuration
```
