#!/usr/bin/env bash
# Sauvegarde de stumble.db — conserver les 7 dernières copies.
# Usage : bash /srv/web/stumbleclone/scripts/backup.sh
# Cron  : 0 2 * * * /srv/web/stumbleclone/scripts/backup.sh >> /var/log/stumble-backup.log 2>&1
set -euo pipefail

PROJ_DIR="/srv/web/stumbleclone"
DB_FILE="$PROJ_DIR/db/stumble.db"
BACKUP_DIR="$PROJ_DIR/backups"
KEEP=7
SQLITE3=$(command -v sqlite3 || echo "/home/linuxbrew/.linuxbrew/bin/sqlite3")

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y-%m-%d_%H-%M)
DEST="$BACKUP_DIR/stumble-$TIMESTAMP.db"

# .backup est WAL-safe : copie cohérente sans lock exclusif
"$SQLITE3" "$DB_FILE" ".backup '$DEST'"

SIZE=$(du -sh "$DEST" | cut -f1)
echo "[$(date '+%Y-%m-%d %H:%M')] OK — $DEST ($SIZE)"

# Purge : garder seulement les $KEEP plus récentes
SURPLUS=$(ls -t "$BACKUP_DIR"/stumble-*.db 2>/dev/null | tail -n +$((KEEP + 1)))
if [ -n "$SURPLUS" ]; then
  echo "$SURPLUS" | xargs rm --
  echo "[$(date '+%Y-%m-%d %H:%M')] Purgé : $(echo "$SURPLUS" | wc -l) ancien(s)"
fi
