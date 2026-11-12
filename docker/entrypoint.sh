#!/bin/sh
set -eu

cd /app

# The data volume only holds mutable state. The Python venv is baked into the
# image, so always point the path the app expects at the image venv.
if [ ! -L conf/gen/python ] || [ "$(readlink conf/gen/python)" != "/opt/ergon-python" ]; then
	rm -rf conf/gen/python
	ln -s /opt/ergon-python conf/gen/python
fi

mkdir -p \
	conf/gen/auth \
	conf/gen/cache \
	conf/gen/deleted \
	conf/gen/temp \
	conf/gen/cache/huggingface \
	conf/gen/cache/u2net

# Keep the bot's existing lifecycle: SIGTERM flushes caches and bridge state.
exec deno run -A --v8-flags=--expose-gc wa.ts
