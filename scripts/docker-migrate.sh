#!/usr/bin/env bash
# Copy the host Postgres database and conf/gen state into Docker volumes.
#
# Usage:
#   scripts/docker-migrate.sh
#   RESET_DATA=1 scripts/docker-migrate.sh   # clear the app data volume and force a DB restore
#   RESTORE_DB=1 scripts/docker-migrate.sh   # force a DB restore over existing container data
#
# A fresh container database is restored automatically. Existing data is only
# replaced when RESTORE_DB=1 or RESET_DATA=1 is set, and a pre-restore dump is
# written to docker/backups/ first.
#
# The host bot may keep running while this script dumps/copies. Stop it before
# starting the container so both processes never use the same WhatsApp session.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.yml)
APP_VOLUME="${APP_VOLUME:-ergon-wa-bot_appdata}"
PG_VOLUME="${PG_VOLUME:-ergon-wa-bot_pgdata}"
STAGING="$(mktemp -d "${TMPDIR:-/tmp}/ergon-docker-migrate.XXXXXX")"
trap 'rm -rf "$STAGING"' EXIT

log() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

for cmd in docker pg_dump python3; do
	command -v "$cmd" >/dev/null 2>&1 || die "missing required command: $cmd"
done
docker info >/dev/null 2>&1 || die "Docker daemon is not available"
[ -f conf/.env ] || die "conf/.env not found"

DB_URL="$(sed -n -E 's/^[[:space:]]*(export[[:space:]]+)?DATABASE_URL=//p' conf/.env | tail -n 1)"
DB_URL="${DB_URL%\'}"; DB_URL="${DB_URL#\'}"
DB_URL="${DB_URL%\"}"; DB_URL="${DB_URL#\"}"
[ -n "$DB_URL" ] || die "DATABASE_URL is not set in conf/.env"

mapfile -t DB_PARTS < <(python3 - "$DB_URL" <<'PY'
import sys, urllib.parse
p = urllib.parse.urlparse(sys.argv[1])
print(urllib.parse.unquote(p.username or ""))
print(urllib.parse.unquote(p.password or ""))
print((p.hostname or "").strip())
print(p.port or 5432)
print(urllib.parse.unquote((p.path or "").lstrip("/")))
print(p.query or "")
PY
)
DB_USER="${DB_PARTS[0]}"
DB_PASS="${DB_PARTS[1]}"
DB_HOST="${DB_PARTS[2]}"
DB_PORT="${DB_PARTS[3]}"
DB_NAME="${DB_PARTS[4]}"
DB_QUERY="${DB_PARTS[5]:-}"
[ -n "$DB_USER" ] && [ -n "$DB_NAME" ] || die "could not parse DATABASE_URL"

CONTAINER_DB_URL="$(python3 - "$DB_USER" "$DB_PASS" "$DB_NAME" "$DB_QUERY" <<'PY'
import sys, urllib.parse
user, password, name, query = sys.argv[1:5]
q = lambda value: urllib.parse.quote(value, safe="")
url = f"postgresql://{q(user)}:{q(password)}@postgres:5432/{q(name)}"
if query:
    url += f"?{query}"
print(url)
PY
)"

log "writing Docker env files"
umask 077
awk -v url="$CONTAINER_DB_URL" '
	BEGIN { replaced = 0 }
	/^[[:space:]]*(export[[:space:]]+)?DATABASE_URL=/ {
		print "DATABASE_URL=" url
		replaced = 1
		next
	}
	{ print }
	END { if (!replaced) print "DATABASE_URL=" url }
' conf/.env > conf/.env.docker
chmod 600 conf/.env.docker

{
	printf 'POSTGRES_DB=%s\n' "$DB_NAME"
	printf 'POSTGRES_USER=%s\n' "$DB_USER"
	printf 'POSTGRES_PASSWORD=%s\n' "$DB_PASS"
} > docker/postgres.env
chmod 600 docker/postgres.env

log "starting Postgres container"
docker volume create "$PG_VOLUME" >/dev/null
docker volume create "$APP_VOLUME" >/dev/null
"${COMPOSE[@]}" up -d postgres

log "waiting for Postgres"
ready=0
for _ in $(seq 1 60); do
	if "${COMPOSE[@]}" exec -T postgres pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
		ready=1
		break
	fi
	sleep 1
done
if [ "$ready" -ne 1 ]; then
	"${COMPOSE[@]}" logs --tail 50 postgres >&2 || true
	die "Postgres did not become ready"
fi

# A fresh container database (no public.users rows) is restored automatically.
# Existing data is only overwritten with RESTORE_DB=1 or RESET_DATA=1.
FORCE_RESTORE=0
if [ "${RESET_DATA:-0}" = "1" ] || [ "${RESTORE_DB:-0}" = "1" ]; then
	FORCE_RESTORE=1
fi

TABLE_EXISTS="$("${COMPOSE[@]}" exec -T postgres psql -tA -U "$DB_USER" -d "$DB_NAME" \
	-c "SELECT to_regclass('public.users') IS NOT NULL" | tr -d '[:space:]')" ||
	die "could not inspect container database"
case "$TABLE_EXISTS" in
	t | f) ;;
	*) die "could not inspect container database" ;;
esac
DB_HAS_DATA=0
if [ "$TABLE_EXISTS" = "t" ]; then
	HAS_ROWS="$("${COMPOSE[@]}" exec -T postgres psql -tA -U "$DB_USER" -d "$DB_NAME" \
		-c 'SELECT EXISTS (SELECT 1 FROM public.users)' | tr -d '[:space:]')" ||
		die "could not inspect container database"
	case "$HAS_ROWS" in
		t | f) ;;
		*) die "could not inspect container database" ;;
	esac
	if [ "$HAS_ROWS" = "t" ]; then
		DB_HAS_DATA=1
	fi
fi

if [ "$DB_HAS_DATA" -eq 1 ] && [ "$FORCE_RESTORE" -eq 0 ]; then
	log "container database already has data; skipping restore"
	log "set RESTORE_DB=1 to overwrite it (a pre-restore dump is written first)"
else
	if [ "$DB_HAS_DATA" -eq 1 ]; then
		mkdir -p docker/backups
		PRE_RESTORE_BACKUP="docker/backups/pre-restore-$(date +%Y%m%d-%H%M%S).sql"
		log "writing pre-restore backup to $PRE_RESTORE_BACKUP"
		"${COMPOSE[@]}" exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" \
			> "$PRE_RESTORE_BACKUP"
		chmod 600 "$PRE_RESTORE_BACKUP"
	fi
	log "dumping host database ($DB_NAME at $DB_HOST:$DB_PORT)"
	pg_dump --no-owner --no-acl --clean --if-exists "$DB_URL" > "$STAGING/db.sql"
	log "restoring database into the container"
	"${COMPOSE[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
		< "$STAGING/db.sql" >/dev/null
fi

log "staging conf/gen (excluding the host Python venv)"
mkdir -p "$STAGING/appdata"
tar -C conf/gen \
	--exclude='./python' \
	--exclude='./bridge.db-wal' \
	--exclude='./bridge.db-shm' \
	-cf - . | tar -C "$STAGING/appdata" -xf -

if [ -f conf/gen/bridge.db ]; then
	log "taking a consistent SQLite bridge snapshot"
	python3 - "$STAGING/appdata/bridge.db" <<'PY'
import sqlite3, sys
src = sqlite3.connect("conf/gen/bridge.db")
dst = sqlite3.connect(sys.argv[1])
with dst:
    src.backup(dst)
dst.close()
src.close()
PY
	rm -f "$STAGING/appdata/bridge.db-wal" "$STAGING/appdata/bridge.db-shm"
fi

log "copying app state into volume $APP_VOLUME"
docker volume create "$APP_VOLUME" >/dev/null
"${COMPOSE[@]}" stop app >/dev/null 2>&1 || true
if [ "${RESET_DATA:-0}" = "1" ]; then
	docker run --rm --entrypoint sh -v "$APP_VOLUME:/data" postgres:18-alpine \
		-c 'rm -rf /data/* /data/.[!.]* /data/..?* 2>/dev/null || true'
fi
tar -C "$STAGING/appdata" -cf - . | docker run --rm -i --entrypoint sh -v "$APP_VOLUME:/data" \
	postgres:18-alpine -c 'tar -C /data -xf - && chown -R 1993:1993 /data'

log "migration complete"
cat <<'EOF'

The database and app state are now in Docker volumes:
  ergon-wa-bot_pgdata
  ergon-wa-bot_appdata

Stop the host bot before starting the container (same WhatsApp session):
  pm2 stop wa
  docker compose up -d
  docker compose logs -f app

Rollback:
  docker compose down
  pm2 restart wa || pm2 start conf/ecosystem.config.cjs
EOF
