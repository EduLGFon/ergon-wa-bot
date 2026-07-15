# ⭐ Ergon 🤖 ⭐

### ✨ Ergon is a WhatsApp chat bot with some cool features. ✨

> ⚠️ » _Ergon is still under development, feel free to contribute to this repo and leave a_ ⭐

---

# 🤔 What do you mean by "cool features"?:

- [x] Talk to Gemini AI with searching and memories;
- [x] Translate text;
- [x] Speak in 5 languages;
- [x] Reveal view once messages;
- [x] Change its prefix just for you;
- [x] Remove background from stickers;
- [x] Rank members by sent msgs count;
- [x] Create stickers with photos and videos;
- [x] Mass delete group msgs for all members;
- [x] Mention all users in a group in a single msg;
- [x] Run code in multiple programming languages;
- [x] Download videos and audios from many websites;

**and more.**

# 🤔 How to install?

### `1 -` 🛠️ Install runtimes and tools:

- [NodeJS 💩](https://nodejs.org/pt-br/) (for Ergon)

> 🪧 » _Recommended version: 26 or higher_

**OPTIONAL TOOLS**

- [PostgreSQL 🐘](https://www.postgresql.org/download/) (for Database)

> 🪧 » _Recommended version: 16 or higher_

> ⚠️ » You may notice some auth creds/keys storing issues if you don't set a DB, but Ergon will
> still work well. Also, some cmds may require a database to work (e.g. rank) or setting
> user-level language/prefix permanently.

- FFMPEG (for video stickers)

> 🪧 » Run `sudo apt install ffmpeg` to install it on Debian/Ubuntu Linux

- [Python 🐍](https://www.python.org/) (for removing backgrounds)

> 🪧 » _Recommended version: 3.12 or higher_

- You can also use these languages/runtimes inside Ergon or eval. But it's **not required** for any
  base features. only install them if you want to use them.

* [BUN 🧁](https://bun.sh), [DENO 🦕](https://deno.com/), [LuaJIT 🌙](https://luajit.org/), G++
  (C/C++), Rustc (Rust)

### `2 -` 📁 Download or clone the repository:

```bash
# Click on "Code" > "Download ZIP" > Extract

# or
# Clone this repo
git clone https://github.com/EduLGFon/ergon-wa-bot # You need to have git installed to run this cmd
```

### `3 -` 🌿 Setup Wizard & Modes:

Ergon includes an interactive setup wizard and predefined setup scripts to configure the bot to your requirements.

#### 🧙 The Setup Wizard
To start the interactive wizard which guides you through configuring the `.env` configuration file, defaults, timezone, language, and dependencies step-by-step:
```bash
npm run wizard
```
Using the wizard, you can also manage the bot lifecycle:
- **Configure**: Set up environment variables, timezone, language, prefix, database URL, and Gemini API keys.
- **Install/Setup**: Choose Light, Medium, or Strong setup levels.
- **Update**: Run a full update that pulls latest repository commits, updates npm/pip packages, and re-generates schemas.
- **Start/Restart**: Run the bot in the **Foreground** (interactive console) or **Background** (via PM2).
- **Stop**: Stop and clean up running background PM2 processes.
- **Reset**: Perform a Light Reset (deleting session data, cache, and temporary files) or a Strong Reset (truncating auth keys and credentials directly from the database).

#### ⚙️ Predefined Setup Modes
If you prefer running a single command, choose one of these modes based on your environment:

1. **Light Setup** (`npm run setup`)
   - Installs global tools (`prisma`, `pm2`) and Node project dependencies.
   - Ideal if you want a quick test or do not require database persistent data and optional features like video stickers or background removal.

2. **Medium Setup** (`npm run setup:medium`)
   - Includes Light Setup + installs a Python virtual environment with libraries (`rembg`, `onnxruntime`, `yt-dlp`) for background removal on stickers and video downloading.
   - Ideal for full local utility command support without a PostgreSQL database.

3. **Strong Setup** (`npm run setup:strong`)
   - Includes Medium Setup + runs database schema migrations (`prisma db push`) to synchronize with your PostgreSQL database.
   - Ideal for full production environments with message rankings, cached message history, and user-level preference persistence.

---

### `4 -` 🔐 Starting:

- Just scan the QR Code that will appear on terminal and then it's ready!

> ⚠️ » All logs and QR codes will appear on `conf/log.txt`.

# 🎨 New Custom Sticker Engine

Ergon features a custom-built, fast, and robust WhatsApp Sticker Engine that avoids the limitations of standard sticker formatting libraries:

- **⚡ Instant Image Stickers (via `sharp`)**: Static image stickers (including `full`, `crop`, `circle`, and `rounded` formats) are processed using SVG masks on the main thread in under 50ms.
- **🎞️ Single-Pass Video Conversion (via `ffmpeg`)**: Animated video and GIF stickers are encoded using the ffmpeg `split` filter. This allows the bot to decode the video once and write multiple formats (`full` and `crop`) simultaneously, cutting encoding times in half.
- **🧵 Non-blocking Worker Pools**: Video/GIF sticker processing is offloaded to a queue-managed worker thread pool (2 threads by default) so that the bot remains responsive to other users even during heavy rendering tasks.
- **📉 Intelligent Adaptive Compression**: To guarantee that stickers do not get rejected by WhatsApp (which occurs when files exceed 1MB), the engine automatically checks file sizes and retries rendering with progressively lower framerates/quality settings if the limit is exceeded.

---

### Also, read the important notes below

# `-1.` 🗒️ Important Notes:

## Using Download cmd

- For using download cmd you should provide session cookies for YouTube, X (Twitter), TikTok,
  Instagram, etc.
- export your cookies.txt using a browser extension and place it at `conf/gen/cookies.txt`.

## Random delays

- Random Delays are implemented on several places to prevent Ergon from being flagged as a Bot by
  Meta anti-bot detectors.
- **I don't recommend removing it.**

## Updating:

```
# Stopping services
npm run stop

# You can update everything just running:
npm run update
# It will: pull commits from repository,
# update node modules, update deno and bun,
# update python dependencies, generate prisma schema,
# and rebuild source.

# 'update' won't start services.

# Starting services
npm start
```

> ⚠️ » _None of these scripts will update `Python`, `LuaJIT`, `PostgreSQL`, `G++` or `GIT`. You
> still need to do it by yourself_

# Reset

- I recommend you to reset and log out WhatsApp Web sometimes to fix decrypt bugs

```
npm run stop # Stopping services

npm run reset # Cleaning auth, cache and temp

npm start # Starting all services
# Scan QR Code
```

# Extras:

- Experiencing bugs? Open a issue with your problem or make a pull request with the solution.
- I will try to fix it as soon as possible.
- If you need help, feel free to ask me on Discord (it's in my profile).

### I hope you like it :)
