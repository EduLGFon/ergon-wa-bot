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

### `3 -` 🧰 Install dependencies:

> 💡 » _Open the folder in terminal_

```bash
npm install # Download and build dependencies
npm install -g typescript pm2 prisma # production packages
```

### `4 -` 🌿 Preparing the environment:

You can configure the bot however you want in the following files:

- `settings.json` (`settings/settings.example.json`)

```json
{
	"bot": {
		"owners": [""], // bot owners can use dev cmds
		// number without special characters (555) 123-4567 = 5551234567
		"number": "", // phone number
		"link": "", // support channel link
		"region": {
			"timezone": "America/Sao_Paulo",
			"logLanguage": "pt"
		}
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
	},

	"sticker": {
		"packName": ["pack"], // sticker pack name
		"author": ["wall-e"] // sticker author name
	}
}
```

> 💡 » _Rename "`settings.example.json`" to "`settings.json`"_

- `.env` (`.env.example`)

```env
# you NEED a PostgreSQL database to run the bot
DATABASE_URL="postgresql://role:password@host:port/db"

# Optional
GEMINI_KEY="get a key on https://aistudio.google.com/app/apikey"
SOCIAL_USERNAME="social media username of the bot to download media"
SOCIAL_PASSWORD="social media password of the bot to download media"
```

> 💡 » _Rename "`.env.example`" to "`.env`"_

### `5 -` 🚀 Starting:

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
