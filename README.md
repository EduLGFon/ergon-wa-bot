# ⭐ WALL-E 🤖⭐

### ✨ WALL-E is a WhatsApp chat bot with some cool features. ✨

> ⚠️ » _WALL-E is still under development, feel free to contribute to this repo and leave a_ ⭐

---

# 🤔 What do you mean by "cool features"?:

- [x] Translate text;
- [x] Search on Google;
- [x] "Speak" in 5 languages;
- [x] Change its prefix just for you;
- [x] Remove background from images;
- [x] Rank members by sent msgs count;
- [x] Create stickers with photos and gifs;
- [x] Mass delete group msgs for all members;
- [x] Run code in multiple programming languages;
- [x] Download videos and audios from many websites;

**and more.**

# 🤔 How to install?

### `1 -` 🛠️ Install these tools to get started:

- [DENO 🦕](https://deno.com/)

> 🪧 » _Recommended version: 1.38 or higher_

- [NodeJS 💩](https://nodejs.org/pt-br/)

> 🪧 » _Recommended version: 20 or higher_

- [Python 🐍](https://www.python.org/)

> 🪧 » _Recommended version: 3.10 or higher_

- [PostgreSQL 🐘](https://www.postgresql.org/download/)

> 🪧 » _Recommended version: 14 or higher_

- [GIT CLI](https://git-scm.com/downloads)

> 🪧 » _Only required to clone this repo_

**OPTIONAL TOOLS REQUIRED ONLY TO RUN CODE:**

- [LUA 🌙](https://www.lua.org/)

> 🪧 » _Recommended version: 5.4 or higher_

- [G++ 🔥]()

> 🪧 » _Recommended version: 11.4 or higher_

### `2 -` 📁 Download or clone the repository:

```bash
"Code" > "Download ZIP"

or

git clone https://github.com/Sunf3r/WALL-E # Clone this repo
```

### `3 -` 🧰 Install dependencies:

> 💡 » _Open the folder in terminal_

```bash
npm install # Download and build dependencies
npm install -g typescript pm2 prisma # production packages
```

### `4 -` 🌿 Preparing the environment

You can configure the bot however you want in the following files:

- `config.json` (`src/Core/JSON/config.example.json`)

```json
{
	"PREFIX": ".", // Bot cmds prefix
	"LANG": "PT", // Default language
	"TIMEZONE": "America/Sao_Paulo",
	"DEVS": ["devs ID"], // number without special characters ((555) 123-4567 = 5551234567)
	"LINK": "dsc.gg/wallebot", // support channel link
	"PACK": ["", ""], // Stickers pack name
	"AUTHOR": ["", ""] // Stickers author name
}
```

> 💡 » _Rename "`config.example.json`" to "`config.json`"_

- `.env` (`.env.example`)

```env
DATABASE_URL="postgresql://role:password@host:port/db"
SOCIAL_USERNAME="social media username of the bot to download media"
SOCIAL_PASSWORD="social media password of the bot to download media"
```

> 💡 » _Rename "`.env.example`" to "`.env`"_

### `5 -` 🚀 Getting Started:

> 💡 » _If it's your first time running the bot, you need to format the database:_

```bash
npm run prisma:push
```

And finally:

```bash
npm run postinstall # build and generate Prisma types


npm run start
or
npm run tsnd # You need TS-NODE
```

---

### I Hope you like the project :)
