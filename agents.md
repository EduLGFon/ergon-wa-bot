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
