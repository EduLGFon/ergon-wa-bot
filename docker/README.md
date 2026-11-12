# Docker deployment

The Compose stack runs the bot and PostgreSQL together:

- `app`: Deno bot image with ffmpeg, pdftotext, Python (rembg/yt-dlp/faster-whisper) and the
  language runners.
- `postgres`: PostgreSQL 18, reachable only on the internal `ergon` network.
- `ergon-wa-bot_appdata`: `conf/gen` (SQLite bridge DB, deleted-message store, caches, cookies, temp
  files).
- `ergon-wa-bot_pgdata`: PostgreSQL data directory (including the WhatsApp auth session).

Secrets stay on the host. `conf/.env` remains the source of truth; the migration script generates
`conf/.env.docker` (same file with `DATABASE_URL` pointed at the `postgres` service) and
`docker/postgres.env`. Both generated files are gitignored.

## First migration from the host

The migration is safe to run while the host bot is still online: Postgres is dumped, SQLite is
snapshotted with its backup API, and `conf/gen` is copied without the host Python venv.

```bash
scripts/docker-migrate.sh
```

This creates the volumes, restores the database when the container database is fresh, and copies the
app state. The database is restored automatically only when there are no rows in `public.users`. If
the container already has data, the script skips the restore and only copies app state. Then stop
the host bot before starting the container, because both would use the same WhatsApp session:

```bash
pm2 stop wa
docker compose up -d --build
docker compose logs -f app
```

If the container fails, roll back with:

```bash
docker compose down
pm2 restart wa || pm2 start conf/ecosystem.config.cjs
```

## Daily use

```bash
docker compose ps
docker compose logs -f app
docker compose restart app
docker compose stop
docker compose up -d
```

PostgreSQL has no host port. Use the container for shell access:

```bash
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

## Updating

```bash
git pull
docker compose build app
docker compose up -d app
```

`conf/gen/python` in the data volume is a symlink to the venv baked into the image, so rebuilding
the image also updates rembg/yt-dlp/faster-whisper.

## Volumes and backups

The volumes are declared `external` so Compose never deletes them accidentally.
`docker compose
down -v` does not remove them; use `docker volume rm` only when you really mean to
erase state.

Postgres backup:

```bash
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  > backup-$(date +%F).sql
```

App-state backup:

```bash
docker run --rm -v ergon-wa-bot_appdata:/data -v "$PWD":/backup postgres:18-alpine \
  tar -C /data -czf /backup/appdata-$(date +%F).tgz .
```

## Re-running the migration

A fresh container database is restored automatically. When `public.users` already has rows, the
script skips the database restore and only copies app state.

`RESTORE_DB=1` forces the database restore. This is destructive: the current container database is
dumped to `docker/backups/pre-restore-YYYYmmdd-HHMMSS.sql` (gitignored), then replaced with the host
database, so any rows written in the container since the last migration are lost unless you restore
that backup.

```bash
RESTORE_DB=1 scripts/docker-migrate.sh
```

`RESET_DATA=1` clears the app-state volume before copying and also forces the database restore.
Without it, files are overwritten but extras from an older migration may remain.

```bash
RESET_DATA=1 scripts/docker-migrate.sh
```

## Manual volume setup

The migration script creates the external volumes. If you skip it, create them before the first
`docker compose up`:

```bash
docker volume create ergon-wa-bot_pgdata
docker volume create ergon-wa-bot_appdata
```

A new `pgdata` volume starts with an empty database. The migration script is what copies the host
schema and data, so without it (or a manual dump and restore) the bot has no data to work with.
Running the migration script later also works: it detects the empty database and restores it
automatically.
