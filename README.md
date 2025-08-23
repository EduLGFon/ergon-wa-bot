# ⭐ Ergon 🤖 ⭐

### ✨ Ergon is a WhatsApp chat bot with some cool features. ✨

> ⚠️ » _Ergon is still under development, feel free to contribute to this repo and leave a_ ⭐

> ⚠️ » Disclaimer: WhatsApp is replacing phone numbers by lids, so I'm replacing it on DB to prevent
> sendind msgs problems. Unfortunately, it would be just hard and slow to migrate all users. So you
> should truncate `users` and `msgs` tables.

---

# 🤔 What do you mean by "cool features"?:

- [x] Talk to Gemini AI with searching, memories and alarms;
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

> 🪧 » _Recommended version: 24 or higher_

**OPTIONAL TOOLS**

- [PostgreSQL 🐘](https://www.postgresql.org/download/) (for Database)

> 🪧 » _Recommended version: 16 or higher_

> ⚠️ » You may notice some auth creds/keys storing issues if you don't set a DB, but Ergon will
> still work well. Also, some cmds may require a database to work (e.g. rank/alarm) or setting
> user-level language/prefix permanently.

- FFMPEG (for video stickers)

> 🪧 » Run `sudo apt install ffmpeg` to install it on Debian/Ubuntu

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
git clone https://github.com/Sunf3r/Ergon # You need to have git installed to run this cmd
```

### `3 -` 🌿 Preparing the environment:

- `.env` (`conf/.env.example`)

> 💡 » _Set sensitive keys and **rename "`.env.example`" to "`.env`"**_. if you have a database,
> remove the # before DATABASE_URL and fill the URL.

```
DATABASE_URL="postgresql://role:password@host:port/db"
DEVS="number01|number02|number03"
GEMINI="get a key on https://aistudio.google.com/app/apikey"
```

You can also set default configuration:

- `defaults.json` (`conf/defaults.json`)

```json
{
	"lang": "pt", // bot default language
	"prefix": ".", // bot default prefix
	"timezone": "America/Sao_Paulo", // logs timezone
	"cache": {
		"users": 200, // max users in cache
		"groups": 200, // max groups in cache
		"dmMsgs": 10, // max msgs per DM chat
		"groupMsgs": 200 // max msgs per group
	}
}
```

### `3 -` 🧰 Installing dependencies and starting 🚀:

> 💡 » _Open the folder in terminal_

```bash
cd Ergon

# This script will do everything to prepare the bot for
# **the first time**, *but you need to do steps 1~3 first*
# You DO NOT need to run setup EVERY TIME you want to start the bot.
npm run setup
# It will: install tsc/pm2/prisma as global modules,
# install node modules,
# generate prisma schema, build source,
# create python virtual environment,
# install python dependencies,
# and >start the bot< with pm2

# if you have a database, run this one after setup. it will also push db schema 
npm run setup:full

# To stop Ergon:
npm run stop

# To start it again:
npm start
# yea, you don't need "run" for start.
# Just "npm start" instead of "npm run start"
```

### `4 -` 🔐 Log in:

## Just scan the QR Code that will appear on terminal and then it's ready!

> ⚠️ » All logs and QR codes will appear on `conf/log.txt`.

# `-1.` 🗒️ Important Notes:

- Random Delays are implemented on several places to prevent Ergon from being flagged as a Bot by
  Meta anti-bot detectors. I don't recommend removing it.

- Updating:

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

- I recommend you to reset and log out WhatsApp Web sometimes to fix decrypt bugs

```
npm run stop # Stopping services

npm run reset # Cleaning auth, cache and temp

npm start # Starting all services
# Scan QR Code
```

- Experiencing bugs? Open a issue with your problem or make a pull request with the solution. I will
  try to fix it as soon as possible.

- This bot was made to run on Linux, but you can run it on Windows just changing script or using
  WSL.

- If you need help, feel free to ask me on Discord (it's in my profile).

### I hope you like it :)
