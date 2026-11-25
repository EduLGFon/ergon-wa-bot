//
// Shared duration limits for the sticker engine.
//
/**
 * WhatsApp caps animated stickers at 10 seconds.
 *
 * The animated video and the embedded audio sidecar must use the same cap,
 * otherwise the soundtrack ends before the animation.
 */
export const STICKER_MAX_DURATION_S = 10
