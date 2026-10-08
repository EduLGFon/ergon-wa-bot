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
