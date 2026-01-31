# Repository Guidelines

## Project Structure & Module Organization

TypeScript entry points sit at the repo root (`wa.ts`, `map.ts`). Responsibilities stay segmented:
`cmd/` implements chat commands, `class/` models WhatsApp data, `event/` consumes socket callbacks,
`plugin/` exposes integrations (auth, Prisma, cache), and `util/` hosts shared helpers.
Configuration, schema files, cookies, and PM2 settings are centralized inside `conf/`, with
translations in `locale/`. The `build/` folder mirrors the source layout for compiled JavaScript,
while `test/` stores fixtures and rollback snapshots.

## Build, Test, and Development Commands

`npm run setup` handles first-time provisioning (deps, build, Python venv); use `npm run setup:full`
when a PostgreSQL DB is configured. `npm run build` performs a clean TypeScript compile,
`npm run tscw` watches for edits, and `npm start` launches the PM2 process in
`conf/ecosystem.config.cjs`. `npm run dev` runs the Deno copilot, `npm test` executes
`node build/wa.js`, and `npm run fmt` enforces `conf/deno.jsonc`. Use `npm run prisma:gen` /
`npm run prisma:push` for schema work.

## Coding Style & Naming Conventions

Stick to ES modules targeting Node ≥22. Keep the `cmd/<group>/<feature>.ts` naming scheme; use
kebab-case by default and reserve PascalCase filenames for `class/` models. Apply `PascalCase` to
classes, `camelCase` to values/functions, and limit `SCREAMING_SNAKE_CASE` to env-style constants.
Depend on shared types from `class/` and `util/messages.ts` rather than redefining payloads. Tabs
are standard, so run `npm run fmt` before every commit.

## Testing Guidelines

Automated coverage is thin, so treat `npm test` as the regression check: it loads the compiled bot
and surfaces runtime errors quickly. When modifying rollback assets under `test/abuild`, keep
filenames and hierarchy aligned with `build/` so diffs stay readable. Document manual flows (QR
scans, critical commands) inside the PR description when scripting a test is impractical.

## Commit & Pull Request Guidelines

Commits stay short and imperative (“fix pg auth state”, “limit login attempts”) without trailing
punctuation; add a brief body only for context such as migrations or locale updates. Each PR should
summarize behavior changes, note DB/schema impacts, list the commands run (build/test/start), and
attach screenshots or logs for user-visible updates. Rebase onto `master` before review to keep
history linear.

## Security & Configuration Tips

Copy `conf/.env.example` to `conf/.env` for local secrets and never commit the result. Cookies
belong in `conf/cookies.txt`, and logs/screenshots should hide QR codes or auth tokens. Use
`npm run reset` to wipe `conf/auth`, `conf/cache`, and `conf/temp` before sharing artifacts.
Maintain the background-removal dependencies through `npm run setup:py`, which isolates them inside
`conf/venv/`.
