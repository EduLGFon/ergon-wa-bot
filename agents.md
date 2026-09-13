# Agent Workspace Rules

## Conversation rules

- Avoid AI tropes and excessive AI fingerprints such as em-dashes ("—"), headline biscuit pills,
  overly robotic filler, and unnatural prose in message templates and generated outputs. Prefer
  clean, standard hyphens ("-") and natural human-like formatting.
- Be concise and direct in your responses. Avoid verbosity.

## Code rules

- Imports in every file must be organized descending by line length (longest on top to shortest on
  bottom of the imports section).
- Prefer small, focused files (~150 lines as a soft guide, not a hard budget). Judge each case:
  splitting a cohesive module across files can hurt readability more than a slightly longer file
  helps it. Split when a file mixes responsibilities or becomes hard to follow; keep it whole when
  the logic reads best in one place. Avoid overly large files and complex syntax.
- In all files: include a top-of-file comment describing what the file does and why it is needed
  (giving the most important context up front). Always write good comments on functions and
  non-obvious code, adhering to good commenting practices.
- Follow Clean Code, SOLID, KISS, YAGNI, and DRY. Keep functions small, pure where possible, and
  with single responsibility. Prefer composition over inheritance, explicit error handling over
  silent failures, and early returns over deep nesting.
- This workspace is Deno-only. Prefer in this order: (1) built-in Deno and Web-standard APIs like
  `Deno.serve`, `Deno.mkdir`, `Deno.Command`, `fetch`, then (2) Deno-native libraries (std/JSR),
  then (3) Deno-first packages. Use Node/npm packages only as a last resort.

## Workflow rules

- After any code changes, always verify and format by running these exact commands in order, with no
  file arguments:
  1. `deno check`
  2. `deno lint`
  3. `deno fmt`
- All test scripts, debug scripts, and other helper files created by agents must be saved inside the
  `scripts/` directory. Never leave scratch files in the repository root.
- When asked to commit, use atomic Conventional Commits: one commit per small logical change
  (`type(scope): short description`, e.g. `fix(chart): ...`). Group several files in the same commit
  only when together they implement a single thing. Never bundle unrelated changes in one commit.
- Delegate independent workstreams and context-heavy exploration to subagents via the Task tool;
  handle trivial or tightly-coupled work directly to avoid overhead.

## Documentation rules

- Before making architectural changes (new modules, data flows, runtime lifecycle, bridge topology,
  persistence, config), read `docs/ARCHITECTURE.md` first and follow the structure it describes.
- When your change alters anything described there, update the affected sections in the same commit
  so the doc never drifts from the code.
