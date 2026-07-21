#!/usr/bin/env bash
set -Eeuo pipefail

LABEL="${1:-scheduled}"
BACKUP_DIR="/var/backups/luzicka"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILENAME="luzicka-${TIMESTAMP}-${LABEL}.sqlite"

mkdir -p "$BACKUP_DIR"

if ! docker inspect luzicka >/dev/null 2>&1; then
  echo "Kontejner Lužická neběží; záloha přeskočena." >&2
  exit 0
fi

if ! docker exec luzicka test -f /data/luzicka.sqlite; then
  echo "Databáze zatím neexistuje; záloha přeskočena."
  exit 0
fi

docker exec -e BACKUP_FILE="/backups/$FILENAME" luzicka node -e '
  const { DatabaseSync } = require("node:sqlite");
  const target = process.env.BACKUP_FILE;
  if (!/^\/backups\/[A-Za-z0-9._-]+$/.test(target)) throw new Error("Neplatná cesta zálohy");
  const db = new DatabaseSync("/data/luzicka.sqlite");
  db.exec(`VACUUM INTO '\''${target}'\''`);
  db.close();
'

chmod 600 "$BACKUP_DIR/$FILENAME"
find "$BACKUP_DIR" -type f -name 'luzicka-*.sqlite' -mtime +30 -delete
ls -1t "$BACKUP_DIR"/luzicka-*.sqlite 2>/dev/null | tail -n +61 | xargs -r rm -f

echo "Záloha vytvořena: $BACKUP_DIR/$FILENAME"
