High viability (small, well-supported APIs on both ends)

1. Own WhatsApp messages don't mirror to Telegram — wa-to-tg.ts:61 skips all fromMe, so anything you
   send from your phone never appears in the topic. Fixable: relay fromMe messages whose ID isn't in
   reply_map (i.e. not a TG→WA echo) with a You: label. Viability: high. Only subtlety is the echo
   race (save the sent-ID synchronously or keep a pending set).
2. WhatsApp location/contact/live-location/poll mapping — now handled natively (venue/contact/native
   sendPoll) for every poll-creation version; only exotic variants without a Telegram equivalent
   post a ⚠️ notice.
3. Message edits duplicate instead of updating — neither unwrap() peels editedMessage nor is there
   an edit path, so a WA edit relays as a second new message; TG edited_message updates are ignored
   entirely. Mapping exists, so editMessageText/Caption (TG, 48h window) and Baileys edit-of-own
   (~~15 min window) plug straight in. Viability: high, with graceful degradation outside the
   windows.
4. Text formatting is stripped — TG entities (bold/italic/code) arrive on WA as plain text and vice
   versa. Entity-offset → _bold_/_italic_ conversion is mechanical. Viability: high.
5. Can't start a chat from Telegram — topics only originate from WA inbound. A /new <phone> command
   (create topic + mapping, first send creates the WA chat) closes the loop. Viability: high.
6. Group service events — joins/leaves, subject or photo changes never reach the topic. Baileys
   already emits group-participants.update; relay as small service lines. Viability: high.

Medium viability (possible, with platform caveats) 7. Delete/revoke sync — Baileys emits
messages.delete; TG has deleteMessage. Works cleanly WA→TG only if the bot has delete-admin rights
(it already needs admin for topics, but "delete messages" is a separate toggle), and TG→WA revoke
only works for the bot's own messages within ~2 days. Expect partial coverage. Viability: medium. 8.
Media albums — a TG album (media_group_id) or several WA images relay as N disconnected messages.
Grouping needs a ~1s batching window on each side. Viability: medium; complexity is all in the
windowing, not the APIs. 9. Round video notes / GIFs — TG video_note currently degrades to a plain
video (loses the round bubble); WA has ptv support in this Baileys version (messages.js handles
ptvMessage), grammy has sendVideoNote. Viability: medium. 10. Animated/video sticker fidelity TG→WA
— currently falls back to video/document since WA stickers must be WebP. True conversion (.tgs/.webm
→ animated WebP via ffmpeg, and the repo already has plugin/sticker/ffmpeg.ts) is doable but
finicky. Viability: medium. 11. Per-chat controls — no allowlist/blocklist, no per-topic mute, no
/ignore. Trivial DB + command work, purely a product decision. Viability: medium-high. 12. Error
visibility — relay failures only hit server logs; the topic never finds out a photo silently didn't
cross (e.g. TG's 20MB bot download cap, WA size limits). Posting a small ⚠️ notice to the affected
topic is easy. Viability: high technically, medium as a priority call. 13. Live polls — now
implemented: native WA polls both ways plus live vote sync via a tally message (`plan.md` §6).
Remaining limits: a sent TG poll can't be re-edited and WA poll payloads are immutable, so
close/stop isn't mirrored.

Low viability / out of scope (platform won't allow it properly) 14. Read receipts / presence — Bot
API can't mark arbitrary messages as read or observe reads; typing indicators (sendChatAction) are
possible but add noise for near-zero value. Viability: low. 15. History backfill — topics start
empty; Baileys history-sync is unreliable and TG can't inject old-dated messages. Viability: low.
16. Status/stories, calls, channels — Bot API exposes none of these usefully, and calls can't be
bridged by any bot architecture. Would need a userbot, different project. Viability: very low. 17.
Mentions/identity mapping — @user mentions can't resolve to real identities cross-platform;
names-as-text is the ceiling. Viability: low.
