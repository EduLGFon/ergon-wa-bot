# Gemini Context

This document provides a comprehensive overview of the Ergon WhatsApp bot project, intended to be
used as instructional context for Gemini.

## Project Overview

Ergon is a feature-rich WhatsApp bot built with TypeScript and Node.js. It utilizes the Baileys
library to interact with WhatsApp. The bot has a command and event-based architecture, making it
easily extensible.

### Key Features:

- Gemini AI integration for chat, search, and alarms.
- Multi-language support with translation capabilities.
- Sticker creation from images and videos.
- Group management features like ranking members and mentioning all users.
- Code execution in multiple programming languages.
- Video and audio downloading from various websites.

### Architecture:

- **Main Entry Point:** `wa.ts` initializes the bot, connects to WhatsApp, and loads commands and
  events.
- **Command Handler:** `util/handler.ts` dynamically loads commands from the `cmd` directory. Each
  command is a class that extends the abstract `Cmd` class defined in `class/cmd.ts`.
- **Event Handler:** `util/handler.ts` also loads event listeners from the `event` directory. These
  events correspond to the events emitted by the Baileys library.
- **Configuration:** The bot is configured through `conf/defaults.json` and environment variables in
  `conf/.env`.
- **Database:** The bot uses Prisma for database access, with the schema defined in
  `conf/schema.prisma`.

## Building and Running

### Dependencies:

- Node.js (v22 or higher)
- PostgreSQL (optional, but required for some features)
- FFMPEG (for video stickers)
- Python (for removing backgrounds from images)

### Installation and Setup:

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Sunf3r/Ergon
   ```
2. **Install dependencies and setup the environment:**
   ```bash
   npm run setup
   ```
   This command will:
   - Install global and local npm packages.
   - Create a Python virtual environment and install Python dependencies.
   - Build the project.
   - Start the bot using pm2.

3. **Full setup with database:**
   ```bash
   npm run setup:full
   ```
   This command will do everything in `npm run setup` and also push the Prisma schema to the
   database.

### Running the bot:

- **Start:**
  ```bash
  npm start
  ```
- **Stop:**
  ```bash
  npm run stop
  ```
- **Restart:**
  ```bash
  npm run restart
  ```
- **Development mode:**
  ```bash
  npm run dev
  ```
  This will run the bot with watch mode enabled, automatically restarting it on file changes.

### Building:

- **Build the project:**
  ```bash
  npm run build
  ```
  This will compile the TypeScript code into JavaScript in the `build` directory.

## Development Conventions

### Command Structure:

All commands are located in the `cmd` directory and are organized into subdirectories based on their
category (e.g., `fun`, `util`, `dev`). Each command must extend the abstract `Cmd` class
(`class/cmd.ts`) and implement the `run` method.

The `Cmd` class has the following properties:

- `name`: The name of the command.
- `alias`: An array of aliases for the command.
- `cooldown`: The command's cooldown in milliseconds.
- `access`: An object that defines the command's permissions (e.g., `dm`, `groups`, `admin`,
  `restrict`).

### Event Structure:

All events are located in the `event` directory and are organized into subdirectories based on the
Baileys event category. Each event file exports a function that is executed when the corresponding
Baileys event is emitted.

### Code Style:

The project uses `deno fmt` for code formatting. To format the code, run:

```bash
npm run fmt
```
