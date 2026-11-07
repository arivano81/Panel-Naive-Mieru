#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

CONFIG="/etc/rixxx-panel/config.json"
APP_DIR="/opt/panel-naive-mieru"
REPORT="/root/vertaflux-install-report.txt"

die() { echo "ERROR: $*" >&2; exit 1; }
[[ ${EUID:-$(id -u)} -eq 0 ]] || die "Запустите от root: sudo bash $0"
[[ -s "$CONFIG" ]] || die "Не найден конфиг панели: $CONFIG"
command -v jq >/dev/null || die "Не установлен jq"
command -v node >/dev/null || die "Не установлен Node.js"
command -v pm2 >/dev/null || die "Не установлен PM2"
[[ -d "$APP_DIR/node_modules/bcryptjs" ]] || die "Не найден bcryptjs в $APP_DIR/node_modules"

random_password() { openssl rand -hex 24; }

ADMIN_USER="$(jq -r '.adminUser // "admin"' "$CONFIG")"
PANEL_DOMAIN="$(jq -r '.panelDomain // empty' "$CONFIG")"
WEB_BASE_PATH="$(jq -r '.webBasePath // empty' "$CONFIG")"
BASIC_USER="$(jq -r '.panelBasicAuthUser // "admin"' "$CONFIG")"
VPN_DOMAIN="$(jq -r '.domain // empty' "$CONFIG")"
SUB_URL="$(jq -r '.subBaseUrl // empty' "$CONFIG")"

read -r -p "Логин администратора панели [$ADMIN_USER]: " value
ADMIN_USER="${value:-$ADMIN_USER}"
read -r -s -p 'Новый пароль панели [Enter = сгенерировать]: ' ADMIN_PASS
echo
ADMIN_PASS="${ADMIN_PASS:-$(random_password)}"
read -r -p "Логин HTTP Basic Auth [$BASIC_USER]: " value
BASIC_USER="${value:-$BASIC_USER}"
read -r -s -p 'Новый пароль HTTP Basic Auth [Enter = сгенерировать]: ' BASIC_PASS
echo
BASIC_PASS="${BASIC_PASS:-$(random_password)}"

BACKUP="${CONFIG}.access-backup-$(date +%Y%m%d-%H%M%S)"
cp -a "$CONFIG" "$BACKUP"

RIXXX_CONFIG="$CONFIG" RIXXX_APP="$APP_DIR" RIXXX_ADMIN_USER="$ADMIN_USER" RIXXX_ADMIN_PASS="$ADMIN_PASS" \
node <<'NODE'
const fs = require('fs');
const configPath = process.env.RIXXX_CONFIG;
const bcrypt = require(process.env.RIXXX_APP + '/node_modules/bcryptjs');
const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
cfg.adminUser = process.env.RIXXX_ADMIN_USER;
cfg.adminPassHash = bcrypt.hashSync(process.env.RIXXX_ADMIN_PASS, 12);
cfg.totpEnabled = false;
cfg.totpSecret = '';
cfg.totpLastCounter = -1;
const tmp = configPath + '.access-new';
fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
fs.renameSync(tmp, configPath);
NODE
chmod 600 "$CONFIG"
pm2 restart panel-naive-mieru --update-env >/dev/null

COOKIE="$(mktemp)"
trap 'rm -f "$COOKIE"' EXIT
LOGIN_JSON="$(jq -nc --arg username "$ADMIN_USER" --arg password "$ADMIN_PASS" '{username:$username,password:$password}')"
for _ in 1 2 3 4 5; do
  if LOGIN_RESPONSE="$(curl -fsS -c "$COOKIE" -H 'Content-Type: application/json' -d "$LOGIN_JSON" \
      http://127.0.0.1:3000/api/login)"; then
    LOGIN_OK=1
    break
  fi
  sleep 2
done
[[ "${LOGIN_OK:-0}" == 1 ]] || die "Пароль изменён, но локальный вход не прошёл. Резервная копия: $BACKUP"
CSRF_TOKEN="$(jq -r '.csrfToken // empty' <<<"$LOGIN_RESPONSE")"
[[ -n "$CSRF_TOKEN" ]] || die "Локальный вход не вернул CSRF-токен. Резервная копия: $BACKUP"

if [[ -n "$PANEL_DOMAIN" && -n "$WEB_BASE_PATH" ]]; then
  ACCESS_JSON="$(jq -nc --arg domain "$PANEL_DOMAIN" --arg path "$WEB_BASE_PATH" \
    --arg user "$BASIC_USER" --arg pass "$BASIC_PASS" \
    '{enabled:true,panelDomain:$domain,webBasePath:$path,basicAuthUser:$user,basicAuthPass:$pass}')"
  curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF_TOKEN" -d "$ACCESS_JSON" \
    http://127.0.0.1:3000/api/panel/external-access >/dev/null
fi

VERSION="$(cat /etc/rixxx-panel/version 2>/dev/null | sed -n 's/^panel_version=//p' | head -n1)"
cat > "$REPORT" <<EOF
VERTAFLUX ACCESS REPORT
Generated:             $(date --iso-8601=seconds)
Panel version:         ${VERSION:-unknown}
VPN domain:            ${VPN_DOMAIN:-not configured}
Panel URL:             ${PANEL_DOMAIN:+https://${PANEL_DOMAIN}/${WEB_BASE_PATH}/}
Subscription URL:      ${SUB_URL:-not configured}
Panel username:        ${ADMIN_USER}
Panel password:        ${ADMIN_PASS}
HTTP Basic username:   ${BASIC_USER}
HTTP Basic password:   ${BASIC_PASS}
TOTP:                  disabled (configure again in Settings)
Local panel URL:       http://127.0.0.1:3000/
Config backup:         ${BACKUP}
EOF
chmod 600 "$REPORT"

echo
cat "$REPORT"
echo
echo "Доступ восстановлен. Отчёт сохранён в $REPORT (только для root)."
