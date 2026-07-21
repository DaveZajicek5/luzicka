#!/usr/bin/env bash
set -Eeuo pipefail

compose() {
  cd /opt/luzicka
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

if ! curl -fsS --max-time 5 http://127.0.0.1:8787/health >/dev/null 2>&1; then
  echo "Healthcheck aplikace selhal, restartuju kontejner." >&2
  compose restart app || compose up -d --build app
  sleep 15
  curl -fsS --max-time 5 http://127.0.0.1:8787/health >/dev/null
fi

if ! tailscale status >/dev/null 2>&1; then
  echo "Tailscale není dostupný, restartuju tailscaled." >&2
  systemctl restart tailscaled
fi
