- Store group keys before sending messages.
- Validate automatic sound stickers on Android beta (DM/group, silent mode, older clients, ptt path)
  and remove the proto patch when Baileys supports Message field 134.
- Preserve sound-sticker audio in bridge/reveal.
- Use the encoded visual duration when media metadata lacks duration, so padded sticker audio cannot outlast a short video.
- Harden deviceSentMessage wrapper coverage for quoted view-once in util/msgTools.ts.
