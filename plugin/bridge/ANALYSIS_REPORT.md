# Step 1: WhatsApp Bot Analysis Report

## Library

- **Library**: Baileys (`@whiskeysockets/baileys@7.0.0-rc14`)
- **Version**: `7.0.0-rc14`
- **Runtime**: Deno

## Incoming Messages

- **Event name**: `messages.upsert` (defined in `event/messages/upsert.ts`)
- **Payload shape**: `{ messages: proto.IWebMessageInfo[] }`
- **1:1 vs Group**: Distinguished by `key.remoteJid` containing `@g.us`
- **Sender/JID**: `key.participant` for group members, `key.remoteJid` for 1:1; `key.fromMe`
  indicates self-sent
- **Parsing**: `getCtx()` in `util/msgTools.ts` abstracts raw messages into `Msg`/`CmdCtx` objects

## Outgoing Messages

- **Function**: `bot.sock.sendMessage(jid, content, opts)` via `sendMsg()` abstraction in
  `util/msgAbstractions.ts`
- **Media support**: Images, videos, audio, documents, stickers, voice notes — all supported via
  `downloadMediaMessage` from Baileys
- **Replies/Quotes**: Supported via `{ quoted: opts?.quoted }` option in `sendMsg`

## Message Handling Location

- **Core handler**: `util/handler.ts` loads events from `./event/` directory
- **Main message processing**: `event/messages/upsert.ts` processes all incoming messages
- **Integration point**: Add a new event listener on `bot.sock.ev.on('messages.upsert', ...)` to
  hook into incoming messages without modifying core logic
- **Hook pattern**: `bot.sock.ev.on(name, (...args) => cache.events.get(name)(...args, name))` in
  handler.ts

## Persistence Layer

- **DB**: Drizzle ORM with PostgreSQL (`drizzle-orm@0.45.2`, `postgres@3.4.9`)
- **Schema**: Defined in `conf/schema.ts` (tables: `users`, `msgs`, `authCreds`, `authKey`)
- **File-based fallback**: `useMultiFileAuthState('conf/gen/auth')` when no `DATABASE_URL` is set
- **Recommendation**: Use SQLite for the bridge's mapping store to keep it independent of the main
  bot's PostgreSQL

## Rate Limiting / Queueing / Session Management

- **Rate limiting**: Per-user cooldown system in `Cmd` class (default 3 seconds)
- **Queueing**: No explicit message queue; events processed sequentially via event handlers
- **Session management**: Baileys auth state with PostgreSQL or file-based storage
- **Anti-detection**: `randomDelay()` used on several operations to avoid WhatsApp rate limits
