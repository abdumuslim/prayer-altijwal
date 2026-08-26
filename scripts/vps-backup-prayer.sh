#!/usr/bin/env bash
# vps-backup-prayer.sh — daily pg_dump of the dedicated `prayer` database.
#
# Runs ON THE VPS (not in this repo checkout): dumps the shared PG16 container's
# `prayer` database to a timestamped custom-format file and prunes old dumps.
#
# Install:  chmod +x /opt/prayer/scripts/vps-backup-prayer.sh
#           crontab -e  →  add the line below (runs daily at 03:20 UTC):
#     20 3 * * * /opt/prayer/scripts/vps-backup-prayer.sh >> /var/log/prayer-backup.log 2>&1
set -euo pipefail

# Database dumps are sensitive: keep everything this script creates owner-only,
# regardless of the cron user's (often world-readable) umask.
umask 077

# Overridable parameters (env vars win; defaults suit the VPS layout).
PG_CONTAINER="${PG_CONTAINER:-rag-postgres-1}"
DB_NAME="${DB_NAME:-prayer}"
BACKUP_DIR="${BACKUP_DIR:-/opt/prayer/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"   # tighten even if the dir pre-existed with looser perms

stamp="$(date -u +%Y%m%d-%H%M%S)"
outfile="$BACKUP_DIR/prayer-$stamp.dump"

# Dump as the container's postgres superuser (no password needed via docker exec).
if ! docker exec "$PG_CONTAINER" pg_dump -U postgres --format=custom "$DB_NAME" > "$outfile"; then
  echo "prayer-backup: pg_dump FAILED for '$DB_NAME' in '$PG_CONTAINER'" >&2
  rm -f "$outfile"
  exit 1
fi
chmod 600 "$outfile"   # owner-only; the umask above already sets this for a fresh file

if [ ! -s "$outfile" ]; then
  echo "prayer-backup: dump is empty — $outfile" >&2
  rm -f "$outfile"
  exit 1
fi

# Prune dumps older than KEEP_DAYS — scoped tightly to our own naming pattern.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'prayer-*.dump' -mtime "+$KEEP_DAYS" -delete

size="$(du -h "$outfile" | cut -f1)"
echo "prayer-backup: OK $outfile ($size)"
