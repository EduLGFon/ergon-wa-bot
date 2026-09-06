# Prompt: Build a Telegram Bridge for an Existing WhatsApp Bot

## Context

I already have a working WhatsApp chatbot project (repo attached/provided below). I want you to do
two things, in order:

1. **Analyze the existing WhatsApp bot codebase** and produce a short report on:
   - What WhatsApp library it uses (e.g. Baileys, whatsapp-web.js, etc.) and the version.
   - How incoming messages are currently received (event names, payload shape, whether it
     distinguishes 1:1 vs group chats, how sender/JID is exposed).
   - How outgoing messages are currently sent (function signatures, media support, whether it
     supports replies/quotes).
   - Where message handling logic lives (which file/module is the natural integration point for a
     bridge to hook into, ideally without touching core bot logic).
   - Any existing persistence layer (DB, file-based state) I could reuse for the bridge's mapping
     table, or whether a new lightweight store is needed.
   - Any rate-limiting, queueing, or session-management code already in place that the bridge needs
     to respect.

   Do not change any WhatsApp-side logic yet — just report findings first so I can confirm before
   you build on top of it.

2. **Build a Telegram bridge bot** that turns a single Telegram supergroup (with Forum Topics
   enabled) into a live mirror of my WhatsApp chats, so I can read and reply to WhatsApp from
   Telegram.

## Target architecture

- **One Telegram supergroup, forum-mode enabled.** Each distinct WhatsApp chat (1:1 or group) maps
  to one **forum topic** in that supergroup — _not_ separate Telegram chats per contact.
- **Mapping store**: persistent table of `whatsapp_jid <-> telegram_topic_id` (+ display name, chat
  type, created_at, last_active_at, archived flag). Use SQLite unless the existing bot already has a
  DB worth reusing.
- **WhatsApp → Telegram flow**:
  1. Existing WA bot receives a message.
  2. Bridge looks up the JID in the mapping table.
  3. If no topic exists yet, call `createForumTopic` (name = contact/group name, or phone number if
     name unknown), persist the mapping.
  4. Relay the message into that topic via `message_thread_id`. For WhatsApp _group_ chats, prefix
     the message with the sender's display name/number since the topic represents the whole group.
  5. Media (images, voice notes, video, documents, stickers) must be downloaded from WhatsApp and
     re-uploaded to Telegram in the matching format (photo/voice/video/document).
- **Telegram → WhatsApp flow**:
  1. Bridge receives a Telegram update with `message_thread_id` set.
  2. Reverse-lookup the JID from the mapping table.
  3. Relay the text/media back out through the existing WhatsApp bot's send functions.
  4. Support replies: a Telegram "reply" to a specific message should map to a WhatsApp quoted reply
     where the underlying library supports it.
- **Topic lifecycle**: don't delete mappings when a topic is closed/archived — only create new ones
  for genuinely new JIDs. Provide a way to close stale topics without losing the mapping/history.
- **Rate limiting**: respect Telegram's practical limit of ~1 message/sec into the same chat (topics
  count as the same underlying chat) — implement a small outgoing queue with backoff, not a naive
  loop.
- **Bot permissions**: document the exact Telegram bot setup steps needed (create bot via BotFather,
  add to supergroup, enable Topics, grant `can_manage_topics` admin right).

## Tech preferences

- TypeScript, running on **Deno** (preferred over Node/Bun).
- Telegram side: use **grammY** (Deno-native, has solid forum-topic and `message_thread_id` support)
  rather than Telegraf.
- Keep the bridge as a **separate module/service** from the WhatsApp bot core — integrate via the
  hook points identified in step 1, don't fork or rewrite the WhatsApp bot's internals.
- Favor free/self-hosted pieces (SQLite over a hosted DB) unless the existing bot already depends on
  something else.
- Include `.env`-based config for bot token, supergroup chat ID, and any WhatsApp bot credentials
  already in use.

## Deliverables

1. The analysis report from step 1.
2. A proposed file/module structure before writing code, for me to sign off on.
3. Working TypeScript/Deno code for:
   - the mapping store (schema + basic CRUD),
   - the WhatsApp → Telegram relay,
   - the Telegram → WhatsApp relay,
   - topic auto-creation logic,
   - the outgoing rate-limit queue.
4. A short README covering: BotFather setup steps, required env vars, how to run it alongside the
   existing WhatsApp bot, and known limitations.

## Constraints

- Ask me clarifying questions if the existing WhatsApp bot's message/event shape doesn't cleanly
  support something above (e.g. no group-sender info, no quoted-reply support) rather than guessing
  silently.
- Don't modify WhatsApp-side business logic beyond adding the hook/emit point the bridge needs.
- Prioritize correctness of the JID↔topic mapping over feature breadth — a reliable text-only bridge
  is more useful than a flaky one with every media type half-working.
