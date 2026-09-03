# Agent Workspace Rules

- Avoid AI tropes and excessive AI fingerprints such as em-dashes ("—"), headline biscuit pills,
  overly robotic filler, and unnatural prose in message templates and generated outputs. Prefer
  clean, standard hyphens ("-") and natural human-like formatting.
- Imports in every file must be organized descending by line length (longest on top to shortest on
  bottom of the imports section).
- After fixing any problems or completing code modifications, you MUST always run the following
  commands sequentially to verify and format the codebase:
  1. `deno check` (without specifying a file)
  2. `deno lint`
  3. `deno fmt`
- Always follow Clean Code and SOLID principles.
- Avoid overly large files and complex syntax.
- In all files: include a top-of-file comment describing what the file does and why it is needed
  (giving the most important context up front). Always write good comments on functions and
  non-obvious code, adhering to good commenting practices.
- This workspace is DENO-only. Always choose DENO native libraries/ways instead of DENO-first
  libraries or NODE libraries (this should only be used as a last resort).
