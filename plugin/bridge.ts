// Telegram bridge plugin - single bot entry for the WA-to-TG mirror.
//
// The relay logic stays in bridge/ (one module per concern); this facade is
// the only path the bot uses to own its lifecycle: wa.ts starts it after
// loadEvents(), connection/update.ts reattaches it after every reconnect,
// wa.ts stops it on SIGINT/SIGTERM, and dev/memory.ts reads pressure via
// the re-exported relayCtx/groupNameCache. Importing the bridge only through
// here keeps the plugin boundary narrow and shutdown complete.
import { reattachBridge, startBridge, stopBridge } from '../bridge/mod.ts'
import { groupNameCache, relayCtx } from '../bridge/wa-to-tg/state.ts'

export { groupNameCache, reattachBridge, relayCtx, startBridge, stopBridge }
