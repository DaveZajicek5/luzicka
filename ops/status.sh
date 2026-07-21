#!/usr/bin/env bash
set -u

printf '\n=== Lužická ===\n'
printf 'Čas: %s\n' "$(date --iso-8601=seconds)"
printf 'Uptime: '; uptime -p
printf 'Disk: '; df -h / | awk 'NR==2 {print $3 " / " $2 " (" $5 ")"}'
printf 'Paměť: '; free -h | awk '/Mem:/ {print $3 " / " $2}'

printf '\n--- Aplikace ---\n'
docker ps --filter name='^/luzicka$' --format 'Stav: {{.Status}} | Image: {{.Image}}' || true
if curl -fsS --max-time 5 http://127.0.0.1:8787/health >/dev/null 2>&1; then
  echo 'Healthcheck: OK'
else
  echo 'Healthcheck: SELHAL'
fi

printf '\n--- Tailscale ---\n'
tailscale status --self=true 2>/dev/null || tailscale status 2>/dev/null || true
tailscale serve status 2>/dev/null || true

printf '\n--- Timery ---\n'
systemctl list-timers --all 'luzicka-*' --no-pager || true

printf '\n--- Poslední chyby ---\n'
journalctl -p warning -u 'luzicka-*' --since '24 hours ago' --no-pager -n 30 || true

printf '\n--- Zálohy ---\n'
ls -lh /var/backups/luzicka/luzicka-*.sqlite 2>/dev/null | tail -n 5 || echo 'Zatím žádné.'
