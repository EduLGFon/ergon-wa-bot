# syntax=docker/dockerfile:1

FROM denoland/deno:2.9.8

ARG DEBIAN_FRONTEND=noninteractive

# Runtime tools used by the bot: ffmpeg for stickers/audio, pdftotext for the
# academic calendar, Python for rembg/yt-dlp/faster-whisper, and the optional
# language runners configured in conf/defaults.json.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    g++ \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    luajit \
    nodejs \
    npm \
    poppler-utils \
    python3 \
    python3-pip \
    python3-venv \
    rustc \
    tzdata \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Python venv expected by conf/defaults.json, util/stt.ts and the rembg/yt-dlp
# commands. It lives in the image; the data volume gets a symlink to it.
RUN python3 -m venv /opt/ergon-python \
    && /opt/ergon-python/bin/pip install --no-cache-dir --upgrade pip setuptools wheel \
    && /opt/ergon-python/bin/pip install --no-cache-dir \
        onnxruntime \
        rembg \
        "yt-dlp[default,curl-cffi]" \
        faster-whisper

# Optional Bun runner from conf/defaults.json.
RUN npm install -g bun && npm cache clean --force

WORKDIR /app

# .dockerignore keeps secrets, node_modules and conf/gen out of the image.
COPY --chown=deno:deno . .

RUN deno install --frozen \
    && mkdir -p /app/conf/gen/auth /app/conf/gen/cache /app/conf/gen/deleted /app/conf/gen/temp \
    && mkdir -p /home/deno \
    && chown -R deno:deno /app /home/deno \
    && chmod +x /app/docker/entrypoint.sh

ENV HOME=/home/deno \
    DENO_NO_UPDATE_CHECK=1 \
    NODE_EXTRA_CA_CERTS=/app/conf/smufesrootca.pem \
    HF_HOME=/app/conf/gen/cache/huggingface \
    U2NET_HOME=/app/conf/gen/cache/u2net

USER deno

ENTRYPOINT ["/app/docker/entrypoint.sh"]
