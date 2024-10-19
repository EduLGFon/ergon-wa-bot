# ⭐ WALL-E 🤖 ⭐

### ✨ WALL-E is a WhatsApp chat bot with some cool features. ✨

> ⚠️ » _WALL-E is still under development, feel free to contribute to this repo and leave a_ ⭐

---

# 🤔 What do you mean by "cool features"?:

- [x] Translate text;
- [x] Search on Google;
- [x] Talk to Gemini AI;
- [x] Speak in 5 languages;
- [x] Reveal view once messages;
- [x] Change its prefix just for you;
- [x] Remove background from images;
- [x] Rank members by sent msgs count;
- [x] Create stickers with photos and gifs;
- [x] Mass delete group msgs for all members;
- [x] Run code in multiple programming languages;
- [ ] Download videos and audios from many websites;

**and more.**

# 🤔 How to install?

### `1 -` 🛠️ Install runtimes and tools:

- [🦕 DENO 🦕](https://deno.com/)

> 🪧 » _Recommended version: 1.44 or higher_

- [🧁 BUN 🧁](https://deno.com/)

> 🪧 » _Recommended version: 1.1.17 or higher_

- [💩 NodeJS 💩](https://nodejs.org/pt-br/)

> 🪧 » _Recommended version: 20 or higher_

- [🐍 Python 🐍](https://www.python.org/)

> 🪧 » _Recommended version: 3.10 or higher_

- [🐘 PostgreSQL 🐘](https://www.postgresql.org/download/)

> 🪧 » _Recommended version: 14 or higher_

- [☝️🤓 GIT ☝️🤓](https://git-scm.com/downloads)

> ⚠️ » _Only required to clone this repo_

**OPTIONAL TOOLS REQUIRED ONLY TO RUN CODE:**

- [🌙 LUAJIT 🌙](https://luajit.org/)

> 🪧 » _Recommended version: 2.1 or higher_

- [🔥 G++ 🔥]()

> 🪧 » _Recommended version: 11.4 or higher_

### `2 -` 📁 Download or clone the repository:

```bash
# Click on "Code" > "Download ZIP"

# or
# Clone this repo
git clone https://github.com/Sunf3r/WALL-E # You need git to do this
```

### `3 -` 🌿 Preparing the environment:

You can configure the bot however you want in the following files:

- `settings.json` (`settings/settings.json`)

```json
{
	"bot": {
		"link": "", // support channel link
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
		"userDefault": {
			"prefix": ".", // default prefix to new users
			"language": "pt", // default language to new users
			"cacheLimit": 500 // max users in memory
		},
		"groupDefault": {
			"msgsCacheLimit": 200 // max msgs in memory (for each group)
		}
	}
}
```

- `.env` (`.env.example`)

```env
# you NEED a PostgreSQL database to run the bot
DATABASE_URL="postgresql://role:password@host:port/db"

# Bot devs
DEVS="number01|number02|number03"

# Optional
GEMINI_KEY="get a key on https://aistudio.google.com/app/apikey"
OPENAI_API_KEY="OPENAI API KEY"
SOCIAL_USERNAME="social media username of the bot to download media"
SOCIAL_PASSWORD="social media password of the bot to download media"
```

> 💡 » _Rename "`.env.example`" to "`.env`"_

### `3 -` 🧰 Installing dependencies and starting 🚀:

> 💡 » _Open the folder in terminal_

```bash
# This script will do everything to prepare the bot for the first time
npm run setup
# It will: install tsc/pm2/prisma as global pkgs, push db schema
# install dependencies, generate prisma schema, build the bot and
# start it with pm2

# Later, you can update everything just running:
npm run update
# It will update node dependencies, update deno and bun, regenerate prisma schema,
# and rebuild the bot
```

> ⚠️ » _None of these scripts will update `Python`, `LuaJIT`, `PostgreSQL`, `G++` or `GIT`\nYou still need to do it by yourself_


### `4 -` 🔐 Log in:

Just scan the QR Code that will appear on terminal and your're ready to go!
---

### I Hope you like the project :)

### `-1 -` 🗒️ Note:

This project was made to run on Linux, if you want to run it on Windows, you may need to apply some
patches or use WSL
