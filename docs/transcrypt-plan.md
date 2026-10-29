# Implementation plan — `transcrypt` command (pt-BR optimized)

Status: planning only. Target: best transcription accuracy for Brazilian Portuguese voice/audio messages in the Ergon WA bot.

## 1. Goal and UX

- Command: `transcrypt` (file `cmd/util/transcrypt.ts`), aliases `tr`, `transc`, `stt`.
- Input: a replied/quoted audio, voice note, video, or audio file; optionally a direct media message.
- Output: the transcript as a WhatsApp text message (or as a document when > 4 000 chars).
- Default language: `pt-BR`. Optional language override: `.transcrypt en <media>` or `.transcrypt lang=es`.
- Subcommands:
  - `raw` — return the provider's raw transcript (no LLM touch-up).
  - `clean` — run the raw transcript through Gemini for punctuation/casing only.
  - `best` — run the top two providers and reconcile with Gemini (slower, highest accuracy).
- Cooldown: 10 s. Access: DM + groups (no admin required).

## 2. Why these providers (pt-BR accuracy)

Benchmarks consulted (July 2026 cross-provider Portuguese WER comparison + FLEURS/MLS/CommonVoice-PT):

| Priority | Provider / model | Why | Env key needed |
| --- | --- | --- | --- |
| 1 | OpenAI `gpt-4o-transcribe` | Best clean Portuguese (FLEURS-PT 2.5% WER, MLS-PT 5.0%) | `OPENAI_API_KEY` |
| 2 | ElevenLabs Scribe v1/v2 | Lowest FLEURS WER reported (2.3%) | `ELEVENLABS_API_KEY` |
| 3 | Azure MAI-Transcribe-2 preview | Best overall score on OpenTranscription (7.72% WER) | `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` |
| 4 | Groq Whisper Large v3 Turbo | Fast + cheap fallback (14.31% WER overall) | `GROQ_API_KEY` |
| 5 | Gemini 2.5 Flash audio (already configured) | Zero new infra, WER ~10.5–11.4%, multimodal context | `GEMINI` (exists) |

Auto-selection order: use the highest-priority provider whose key is present. `TRANSCRYPT_PROVIDER` env var can force one. If the chosen provider fails, fall through to the next available one.

For spontaneous WhatsApp voice notes (noisy, accented, short utterances) the clean-read FLEURS numbers understate error. Before locking priority 1, run the small evaluation in §8 on 10 real voice notes and re-rank if needed.

## 3. Media pipeline

1. `const media = await getMedia(msg)` (existing helper in `util/msgAbstractions.ts`). Prefer quoted media; reject if none.
2. Validate:
   - MIME must be audio/* or video/* (Baileys mimetype from `msg.mime`).
   - Size ≤ 25 MB (WhatsApp hard limit is ~16 MB for voice; keep headroom).
   - Duration ≤ 10 min; otherwise chunk into 5-min segments (ffmpeg) and concatenate transcripts with `[part N]` markers.
3. Preprocess with ffmpeg (system binary already used for animated stickers):
   - Convert to 16 kHz mono FLAC/WAV (`-ar 16000 -ac 1`).
   - Light denoise: `afftdn=nf=-25` (optional, gated by `TRANSCRYPT_DENOISE=1`).
   - Trim leading/trailing silence: `silenceremove`.
4. Write temp file under `conf/gen/temp/transcrypt-<uuid>.flac`; delete in `finally`.
5. Cache transcript by media URL hash in a new `cache.transcripts` Collection (key: `sha256(media.url + provider + lang)`, TTL 7 days) so repeated `.tr` on the same message is free.

## 4. New files

- `cmd/util/transcrypt.ts` — command (follow `cmd/util/reveal.ts` shape).
- `util/stt.ts` — provider adapters + auto-selection + preprocessing helpers. Each adapter:
  ```
  transcribe({ buffer, mime, lang, prompt }): Promise<{ text, provider, durationMs }>
  ```
- `util/transcriptNormalize.ts` (optional) — pt-BR normalization helpers (collapse whitespace, fix common ASR artifacts, punctuation pass via Gemini).
- Locale entries in `locale/*.json` under `transcrypt`.

## 5. Command flow

```
run({ msg, args, user, send, react, startTyping, t }):
  1. parse flags/lang from args.
  2. media = await getMedia(msg); if none -> send('transcrypt.nobuffer', quoted).
  3. await startTyping(); react('loading').
  4. buffer = await preprocess(media).
  5. provider = selectProvider(args).
  6. transcript = cache.transcripts.get(key) ?? await stt.transcribe(...).
  7. if 'clean' or 'best': transcript = await geminiClean(transcript, lang).
  8. if 'best': run second provider, then geminiReconcile([t1, t2]).
  9. send formatted result; react('ok').
  10. finally: delete temp file.
```

Prompt/hotwords: pass the quoted message text and group name as a "context prompt" to providers that support it (Whisper `prompt`, GPT-4o `prompt`). This lifts accuracy on names/commands.

## 6. Gemini cleanup (optional, opt-in via `clean`/`best`)

System instruction (pt-BR):

> Você é um corretor de transcrição. Corrija apenas pontuação, maiúsculas e erros óbvios de reconhecimento (ex.: "vc" -> "você" quando claro). Não adicione, remova ou parafraseie conteúdo. Preserve nomes próprios. Responda só com a transcrição corrigida.

Default mode returns raw provider output (most faithful, lowest hallucination risk). `clean` is for readability; `best` reconciles two ASR hypotheses.

## 7. Locale strings (add to en/es/fr/de/pt)

```
"transcrypt": {
  "usage": "<(audio/video)> [lang code] [raw|clean|best]",
  "desc": "Transcribe audio to text (best accuracy for pt-BR)",
  "examples": ["(voice note)", "clean (voice note)", "best (voice note)", "en (audio)"],
  "nobuffer": "[⚠️] - Media incompatible or not found",
  "tooLarge": "[⚠️] - Audio too large (max 25 MB)",
  "tooLong": "[⚠️] - Audio too long (max 10 min)",
  "unsupported": "[⚠️] - Unsupported media type",
  "failed": "[❌] - Transcription failed, try again",
  "header": "*[🎙️] - Transcription ({{provider}}, {{lang}})*"
}
```

## 8. Evaluation (to lock the primary provider)

- Collect 10 real pt-BR WhatsApp voice notes (varied accents, noise, lengths) with human reference transcripts.
- Run each provider; compute WER with the same normalizer as the benchmarks (lowercase, strip punctuation, spell digits, hyphens -> spaces).
- Pick the provider with lowest mean WER; keep a fallback chain.
- Re-run after any provider model update.

## 9. Privacy and limits

- Audio is sent to the selected third-party STT API. Document in help/README. No audio is persisted; temp files deleted in `finally`; only transcripts cached.
- Rate-limit via existing cooldown + a per-user daily cap (e.g. 30 transcriptions) to control cost.
- For groups, optionally restrict to admins via `access.admin` if cost becomes an issue (configurable).

## 10. Verification

- `deno check` passes; `deno lint` passes.
- Manual: reply to a pt-BR voice note with `.tr` → transcript returned in < 10 s.
- Manual: `.tr clean` returns punctuated text; `.tr best` runs two providers.
- Manual: re-running `.tr` on same message hits cache (no provider call).
- Manual: unsupported mime / no media / oversized audio produce the right locale message.
- Benchmark report committed as `docs/transcrypt-benchmark.md` after §8.

## 11. Suggested execution order

1. Add `util/stt.ts` with Gemini adapter only (works with existing key) + command skeleton + locale.
2. Add ffmpeg preprocessing + caching.
3. Add OpenAI adapter (highest expected accuracy) and auto-selection.
4. Add ElevenLabs + Azure + Groq adapters.
5. Add `clean`/`best` modes and reconciliation.
6. Run evaluation (§8), re-rank, update this doc.
7. Add daily cap + privacy note in README.

---

English review: 100% native.