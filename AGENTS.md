Global defaults: ~/.config/opencode/AGENTS.md

## Identity

- WhatsApp bot (Deno 2.x + Baileys) with Gemini AI chat, sticker engine, scheduled UFES (Sao Mateus)
  restaurant bulletins, bidirectional WA<->Telegram forum bridge. Single process from wa.ts.
  Brazil/LGPD scope.
- Stack: Deno 2.x TS; Baileys; grammy (fetch adapter); drizzle-orm + postgres (postgres-js) +
  drizzle-kit; @google/genai; sharp/ffmpeg/node-webpmux; Python venv
  (rembg/onnxruntime/yt-dlp/faster-whisper); i18next; jsr:@libs/qrcode. Import maps + lockfiles.
- Runtime: Deno >=2.0, Python >=3.12, Postgres >=16, ffmpeg system. PM2 prod
  (conf/ecosystem.config.cjs app "wa").
- Overrides: pt-BR user-visible strings, English code/docs/commits, LGPD/ANPD Brazil-only scope,
  import ordering descending by line length with aliases @class/@cmd/@event/@util/@conf.

## Commands

- deno task dev; start:dev; start/restart/stop; db:gen/push/pull; wizard; check; lint; fmt; verify;
  reset; setup[:medium|:strong]; translate; update variants.
- Bridge find-id: deno run -A --env=conf/.env plugin/bridge/mod.ts -- --find-id
- Verify order: deno check -> deno lint -> deno fmt (no file args), then targeted smoke. Tests in
  util/*_test.ts run with deno test; run only touched suites; never claim unrun tests.

## Map

- wa.ts boot; class/; cmd/<cat>/; event/<cat>/; util/; plugin/ and plugin/bridge/; conf/;
  docs/ARCHITECTURE.md; DECISIONS.md; locale/*.json.
- conf/defaults.json tunables; conf/.env.example env reference. ARCHITECTURE section 16 conventions.

## Invariants

- Boot order:
  proto()->locale()->connect()->loadCmds()->cache.resume()->loadEvents()->watchdog->startBridge().
- Outbound only via util/msgAbstractions.ts; inbound only via util/msgTools.ts:getCtx; reconnects
  owned by event/connection/update.ts.
- Bridge shares WA socket; attach after loadEvents(); reattach after reconnect.
- checkPerms gate on every command; restrict=dev only; needsDb degrades with events.nodb.
- Anti-ban pacing/cooldowns/announcer/bridge spacing never removed.
- Caps/budgets in conf/defaults.json must not regress.
- No telemetry/crash reporting/ads/analytics; no second persistence engine or WA/TG client.
- No widened personal-data collection/retention; reply map <=7d; deleted store 100/chat 200 chats.
- Generated: conf/gen/*, node_modules, build, PM2 logs - modify sources, regenerate via tools; never
  commit generated except lockfiles.
- SECURITY:/PRIVACY: markers; references DECISIONS.md#Dxx.

## Do not touch

- conf/gen/*, node_modules, build, PM2 logs; prod state; secrets; live session.
- Agents use local/disposable state only; never run start/restart/stop/reset/db:push/wizard/update
  against live/prod.

## Verify

- deno check -> deno lint -> deno fmt (no file args), then targeted smoke.
  Auth/perm/bridge/sticker/media/download/network changes require RSS/cap-budget check. Secret
  scan + permission-matrix recheck (ARCHITECTURE sections 6/14) before release.
- If a check fails, investigate; never hide; state unrun checks.

## Overrides

- pt-BR user-visible strings; English code/docs/commits. LGPD/ANPD Brazil-only scope; new
  jurisdictions need legal analysis.
- Protected identifiers/content never logged (LIDs, phone JIDs, push names, message text/media,
  recovered deletes, memories, Gemini history, auth creds/keys, cookies, tokens, TG ids). Reply map
  <=7d; deleted store caps.
- Import ordering descending by line length with aliases. Header comment on every file; TODO format
  // TODO(#issue): action - reason. File size ~150 soft, review ~300.
- Update docs/ARCHITECTURE.md in same commit on behavior change; DECISIONS.md append-only;
  .env.example on new config. plan.md referenced but absent - confirm with owner.
- Bridge/TG specifics: handler ordering terminal relay; 4096 chunk via chunk.ts; callback queries
  answered once; roster JIDs @lid prefer MemberItem.pn.
