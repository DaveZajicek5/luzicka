#!/usr/bin/env bash
set -Eeuo pipefail

REPO_DIR="/opt/luzicka"
LOCK_FILE="/run/lock/luzicka-deploy.lock"
INITIAL=false
[[ "${1:-}" == "--initial" ]] && INITIAL=true

exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

wait_for_health() {
  local attempts=0
  until curl -fsS --max-time 4 http://127.0.0.1:8787/health >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    [[ $attempts -ge 30 ]] && return 1
    sleep 2
  done
}

rollback() {
  local previous="$1"
  [[ -z "$previous" ]] && return 1
  echo "Nasazení selhalo, vracím předchozí verzi $previous." >&2
  git reset --hard "$previous"
  compose build
  compose up -d --remove-orphans
  wait_for_health
}

cd "$REPO_DIR"
git fetch --quiet origin main
CURRENT="$(git rev-parse HEAD)"
TARGET="$(git rev-parse origin/main)"

if [[ "$INITIAL" != true && "$CURRENT" == "$TARGET" ]]; then
  exit 0
fi

if docker inspect luzicka >/dev/null 2>&1; then
  bash /opt/luzicka/ops/backup.sh pre-deploy || true
fi

git reset --hard "$TARGET"

if ! compose build --pull; then
  rollback "$CURRENT"
  exit 1
fi

if ! compose run --rm --no-deps app npm test; then
  rollback "$CURRENT"
  exit 1
fi

compose up -d --remove-orphans

if ! wait_for_health; then
  rollback "$CURRENT"
  exit 1
fi

docker image prune -f --filter "until=168h" >/dev/null 2>&1 || true
echo "Lužická nasazena: $TARGET"
