# ⭐ WALL-E 🤖 ⭐

### ✨ WALL-E is a WhatsApp chat bot with some cool features. ✨

> ⚠️ » _WALL-E is still under development, feel free to contribute to this repo and leave a_ ⭐

---

# 🤔 What do you mean by "cool features"?:

- [x] Translate text;
- [x] Talk to Gemini AI;
- [x] Search on Google;
- [x] Speak in 5 languages;
- [x] Set reminders for yourself;
- [x] Reveal view once messages;
- [x] Change its prefix just for you;
- [x] Remove background from stickers;
- [x] Rank members by sent msgs count;
- [x] Create stickers with photos and gifs;
- [x] Mass delete group msgs for all members;
- [x] Mention all users in a group in a single msg;
- [x] Run code in multiple programming languages;
- [ ] Download videos and audios from many websites;

**and more.**

# 🤔 How to install?

### `1 -` 🛠️ Install runtimes and tools:

- [NodeJS 💩](https://nodejs.org/pt-br/) (For WALL-E/Runner/Reminder)

> 🪧 » _Recommended version: 20 or higher_

- [PostgreSQL 🐘](https://www.postgresql.org/download/) (For database)

> 🪧 » _Recommended version: 16 or higher_

**OPTIONAL TOOLS**

- FFMPEG (For gif stickers)

> 🪧 » _You need to install it on your system_
> Run `sudo apt install ffmpeg` for Debian/Ubuntu

- [Python 🐍](https://www.python.org/) (For rmbg plugin)

> 🪧 » _Recommended version: 3.10 or higher_

**WALL-E also support these languages, but you DON'T need to install it if you won't use:**

- [BUN 🧁](https://bun.sh) (Can be used to run the runner)

> 🪧 » _Recommended version: 1.1.34 or higher_

- [DENO 🦕](https://deno.com/)

> 🪧 » _Recommended version: 2.04 or higher_

- [LUAJIT 🌙](https://luajit.org/)

> 🪧 » _Recommended version: 2.1 or higher_

- [G++ 🔥]()

> 🪧 » _Recommended version: 11.4 or higher_

### `2 -` 📁 Download or clone the repository:

```bash
# Click on "Code" > "Download ZIP" > Extract

# or
# Clone this repo
git clone https://github.com/Sunf3r/WALL-E # You need to have git installed to do this
```

### `3 -` 🌿 Preparing the environment:

You can configure the bot however you want in the following files:

- `settings.json` (`settings/settings.json`)

```json
{
	"bot": {
		"link": "dsc.gg/wallebot", // support channel link
		"region": {
			"timezone": "America/Sao_Paulo",
			"logLanguage": "pt"
		}
	},

	"sticker": {
		"packName": ["pack", "name"], // sticker pack name
		"author": ["wall-e", "sticker maker"] // sticker author name
	},

	"db": {
		"user": {
			"prefix": ".", // default prefix to new users
			"language": "pt", // default language to new users
			"cacheLimit": 500, // max users in memory
			"msgsLimit": 200 // max msgs in memory (per user)
		},
		"group": {
			"msgsLimit": 200 // max msgs in memory (per group)
		}
	}
}
```

- `.env` (`settings/.env.example`)

> 💡 » _Open the file to set sensitive keys and rename "`.env.example`" to "`.env`"_

### `3 -` 🧰 Installing dependencies and starting 🚀:

> 💡 » _Open the folder in terminal_

```bash
# This script will do everything to prepare the bot for
# the first time, but you need to do steps 1~3 first
npm run setup
# It will: install tsc/pm2/prisma as global pkgs, push db schema
# install dependencies, generate prisma schema, build the bot and
# start it with pm2

# Later, you can update everything just running:
npm run update
# It will: pull commits from repository, update node dependencies, update deno and bun, regenerate prisma schema,
# and rebuild the bot
```

> ⚠️ » _None of these scripts will update `Python`, `LuaJIT`, `PostgreSQL`, `G++` or `GIT`. You
> still need to do it by yourself_

### `4 -` 🔐 Log in:

## Just scan the QR Code that will appear on terminal and then it's ready!

# `-1.` 🗒️ Notes:

- Experiencing bugs? Open a issue with your problem or make a pull request with the solution. I will
  try to fix it as soon as possible.

- This bot was made to run on Linux, but you can run it on Windows just changing script or using
  WSL.

- If you need help, feel free to ask me on Discord.

### I Hope you like the project :)
