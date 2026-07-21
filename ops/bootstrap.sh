#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="https://github.com/DaveZajicek5/luzicka.git"
REPO_DIR="/opt/luzicka"
ENV_DIR="/etc/luzicka"
ENV_FILE="$ENV_DIR/luzicka.env"
CREDENTIALS_FILE="/root/luzicka-credentials.txt"

if [[ $EUID -ne 0 ]]; then
  echo "Spusťte skript přes sudo: curl ... | sudo bash" >&2
  exit 1
fi

if [[ ! -r /etc/os-release ]] || ! grep -q '^ID=debian$' /etc/os-release; then
  echo "Tento skript je určen pro Debian." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
hostnamectl set-hostname luzicka
timedatectl set-timezone Europe/Prague

# MacBook Air 2015 obvykle používá Broadcom BCM4360, jehož ovladač je v non-free.
if [[ -f /etc/apt/sources.list.d/debian.sources ]]; then
  sed -i -E 's/^Components:.*/Components: main contrib non-free non-free-firmware/' /etc/apt/sources.list.d/debian.sources
fi
if [[ -f /etc/apt/sources.list ]]; then
  sed -i -E '/^deb / { /non-free/! s/ main([[:space:]]|$)/ main contrib non-free non-free-firmware\1/; }' /etc/apt/sources.list
fi

apt-get update
apt-get install -y \
  ca-certificates curl git jq openssl iw wireless-tools network-manager \
  linux-headers-amd64 broadcom-sta-dkms \
  docker.io docker-compose \
  unattended-upgrades needrestart smartmontools

modprobe wl 2>/dev/null || true
systemctl enable --now NetworkManager docker

if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
systemctl enable --now tailscaled

install -d -m 0755 "$REPO_DIR" "$ENV_DIR"
install -d -m 0750 /var/lib/luzicka /var/backups/luzicka
chown -R 1000:1000 /var/lib/luzicka /var/backups/luzicka

if [[ -d "$REPO_DIR/.git" ]]; then
  git -C "$REPO_DIR" fetch origin main
  git -C "$REPO_DIR" reset --hard origin/main
else
  rm -rf "$REPO_DIR"
  git clone --branch main --single-branch "$REPO_URL" "$REPO_DIR"
fi
chmod 0755 "$REPO_DIR"/ops/*.sh

if [[ ! -f "$ENV_FILE" ]]; then
  ADMIN_PASSWORD="$(openssl rand -hex 12)"
  SESSION_SECRET="$(openssl rand -hex 32)"
  cat >"$ENV_FILE" <<EOF
VIEWER_PASSWORD=97E690DC
ADMIN_PASSWORD=$ADMIN_PASSWORD
SESSION_SECRET=$SESSION_SECRET
HOUSEHOLD_NAME=Lužická
SESSION_HOURS=24
EOF
  chmod 0600 "$ENV_FILE"
  cat >"$CREDENTIALS_FILE" <<EOF
Lužická – přístupové údaje
Viewer: 97E690DC
Admin: $ADMIN_PASSWORD
EOF
  chmod 0600 "$CREDENTIALS_FILE"
fi

cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

cat >/etc/apt/apt.conf.d/52luzicka-unattended-upgrades <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-WithUsers "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:15";
EOF

install -d -m 0755 /etc/systemd/logind.conf.d
cat >/etc/systemd/logind.conf.d/99-luzicka-server.conf <<'EOF'
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
IdleAction=ignore
EOF
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target

install -d -m 0755 /etc/NetworkManager/conf.d
cat >/etc/NetworkManager/conf.d/99-luzicka-wifi.conf <<'EOF'
[connection]
wifi.powersave=2
EOF

cat >/usr/local/sbin/luzicka-disable-wifi-powersave <<'EOF'
#!/usr/bin/env bash
for marker in /sys/class/net/*/wireless; do
  [[ -e "$marker" ]] || continue
  iface="$(basename "$(dirname "$marker")")"
  iw dev "$iface" set power_save off || true
done
EOF
chmod 0755 /usr/local/sbin/luzicka-disable-wifi-powersave

cat >/etc/systemd/system/luzicka-wifi.service <<'EOF'
[Unit]
Description=Disable Wi-Fi power saving for Lužická server
After=network.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/luzicka-disable-wifi-powersave
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

install -m 0644 "$REPO_DIR"/ops/systemd/* /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now luzicka-wifi.service
systemctl enable --now luzicka-update.timer luzicka-backup.timer luzicka-watchdog.timer

bash "$REPO_DIR/ops/deploy.sh" --initial

if ! nmcli -t -f TYPE,STATE device status 2>/dev/null | grep -q '^wifi:connected$' && [[ -r /dev/tty ]]; then
  echo
  read -r -p "Název domácí Wi-Fi (Enter = přeskočit, pokud používáte kabel): " WIFI_SSID </dev/tty || true
  if [[ -n "${WIFI_SSID:-}" ]]; then
    read -r -s -p "Heslo k Wi-Fi: " WIFI_PASSWORD </dev/tty
    echo
    nmcli radio wifi on
    nmcli device wifi rescan || true
    nmcli device wifi connect "$WIFI_SSID" password "$WIFI_PASSWORD"
    unset WIFI_PASSWORD
  fi
fi

if ! tailscale ip -4 >/dev/null 2>&1; then
  echo
  echo "Tailscale teď vypíše přihlašovací odkaz. Otevřete ho na telefonu a potvrďte zařízení 'luzicka'."
  tailscale up --hostname=luzicka
fi
tailscale set --ssh=true || true

if ! tailscale serve --bg --yes 8787; then
  echo
  echo "Tailscale může chtít jednorázově povolit HTTPS. Otevřete odkaz, který nyní vypíše."
  tailscale serve --bg 8787
fi

DNS_NAME="$(tailscale status --json | jq -r '.Self.DNSName // empty' | sed 's/\.$//')"
if [[ -n "$DNS_NAME" ]]; then
  URL="https://$DNS_NAME"
  if ! grep -q '^Adresa:' "$CREDENTIALS_FILE"; then
    echo "Adresa: $URL" >>"$CREDENTIALS_FILE"
  fi
else
  URL="$(tailscale ip -4 | head -n1):8787"
fi

echo
echo "============================================================"
echo "Lužická je nainstalovaná."
echo "Adresa: $URL"
echo "Viewer heslo: 97E690DC"
echo "Admin heslo je uloženo v $CREDENTIALS_FILE"
echo
echo "Poslední ruční krok: v Tailscale admin konzoli otevřete Machines → luzicka → … → Disable key expiry."
echo "Po ověření můžete MacBook restartovat: sudo reboot"
echo "============================================================"
