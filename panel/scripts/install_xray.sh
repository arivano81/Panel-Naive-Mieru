#!/usr/bin/env bash
set -euo pipefail

XRAY_VERSION="v26.3.27"
XRAY_ASSET="Xray-linux-64.zip"
XRAY_SHA256="23cd9af937744d97776ee35ecad4972cf4b2109d1e0fe6be9930467608f7c8ae"
XRAY_URL="https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/${XRAY_ASSET}"
XRAY_BIN="/usr/local/bin/xray"
XRAY_DIR="/etc/xray"
XRAY_CONFIG="${XRAY_DIR}/config.json"
XRAY_PUBLIC="${XRAY_DIR}/reality-public.json"
XRAY_UNIT="/etc/systemd/system/xray.service"
PANEL_CONFIG="/etc/rixxx-panel/config.json"
COMPONENT_REGISTRY="/etc/rixxx-panel/components.json"
REPORT="/root/rixxx-xray-install-report.txt"

PORT="${XRAY_PORT:-8443}"
SERVER_NAME="${XRAY_SERVER_NAME:-www.microsoft.com}"
TARGET="${XRAY_TARGET:-${SERVER_NAME}:443}"
FORCE="${XRAY_FORCE:-0}"

log() { printf '[XRAY] %s\n' "$*"; }
die() { printf '[XRAY] ERROR: %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run as root"
[[ "$(uname -m)" == "x86_64" || "$(uname -m)" == "amd64" ]] || die "only amd64 is supported"
for command in curl unzip sha256sum node openssl systemctl jq; do
  command -v "$command" >/dev/null 2>&1 || die "missing dependency: $command"
done
[[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT >= 1024 && PORT <= 65535 )) || die "XRAY_PORT must be 1024..65535"
if ss -H -ltn "sport = :$PORT" 2>/dev/null | grep -q .; then die "TCP port $PORT is already in use"; fi
if [[ "$PORT" != "10085" ]] && ss -H -ltn "sport = :10085" 2>/dev/null | grep -q .; then
  die "loopback Stats API port 10085 is already in use"
fi
if [[ -e "$XRAY_CONFIG" && "$FORCE" != "1" ]]; then
  die "Xray config already exists; refusing to rotate REALITY keys (set XRAY_FORCE=1 explicitly)"
fi
[[ ! -f "$PANEL_CONFIG" ]] || jq empty "$PANEL_CONFIG" >/dev/null 2>&1 || die "panel config is invalid JSON"
[[ ! -f "$COMPONENT_REGISTRY" ]] || jq empty "$COMPONENT_REGISTRY" >/dev/null 2>&1 || die "component registry is invalid JSON"
HAD_BIN=0; HAD_CONFIG=0; HAD_PUBLIC=0; HAD_UNIT=0; HAD_PANEL_CONFIG=0; HAD_REGISTRY=0; HAD_DIR=0
[[ ! -e "$XRAY_BIN" ]] || HAD_BIN=1
[[ ! -e "$XRAY_CONFIG" ]] || HAD_CONFIG=1
[[ ! -e "$XRAY_PUBLIC" ]] || HAD_PUBLIC=1
[[ ! -e "$XRAY_UNIT" ]] || HAD_UNIT=1
[[ ! -e "$PANEL_CONFIG" ]] || HAD_PANEL_CONFIG=1
[[ ! -e "$COMPONENT_REGISTRY" ]] || HAD_REGISTRY=1
if [[ -d "$XRAY_DIR" ]]; then
  HAD_DIR=1
  XRAY_DIR_MODE=$(stat -c '%a' "$XRAY_DIR")
  XRAY_DIR_UID=$(stat -c '%u' "$XRAY_DIR")
  XRAY_DIR_GID=$(stat -c '%g' "$XRAY_DIR")
fi

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ADAPTER="$SCRIPT_DIR/../server/xrayConfig.js"
[[ -f "$ADAPTER" ]] || die "missing Xray config adapter: $ADAPTER"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
ARCHIVE="$WORK/$XRAY_ASSET"

log "downloading pinned Xray ${XRAY_VERSION}"
curl -fL --retry 3 --connect-timeout 15 "$XRAY_URL" -o "$ARCHIVE"
printf '%s  %s\n' "$XRAY_SHA256" "$ARCHIVE" | sha256sum -c - >/dev/null \
  || die "SHA-256 mismatch; nothing was installed"
unzip -q "$ARCHIVE" xray -d "$WORK/unpacked"
"$WORK/unpacked/xray" version | grep -F "${XRAY_VERSION#v}" >/dev/null \
  || die "downloaded binary version does not match $XRAY_VERSION"

KEYS=$("$WORK/unpacked/xray" x25519)
PRIVATE_KEY=$(printf '%s\n' "$KEYS" | sed -nE 's/^(PrivateKey|Private key):[[:space:]]*//p' | head -n1)
PUBLIC_KEY=$(printf '%s\n' "$KEYS" | sed -nE 's/^(Password \(PublicKey\)|Password|Public key):[[:space:]]*//p' | head -n1)
[[ -n "$PRIVATE_KEY" && -n "$PUBLIC_KEY" ]] || die "could not generate REALITY key pair"
SHORT_ID=$(openssl rand -hex 8)

mkdir -p "$XRAY_DIR/backups" /var/lib/xray
chmod 700 "$XRAY_DIR" "$XRAY_DIR/backups"
BACKUP=""
if [[ -e "$XRAY_CONFIG" || -e "$XRAY_BIN" || -e "$XRAY_UNIT" || -e "$PANEL_CONFIG" || -e "$COMPONENT_REGISTRY" ]]; then
  BACKUP="$XRAY_DIR/backups/$(date +%Y-%m-%d-%H%M%S)"
  mkdir -p "$BACKUP"; chmod 700 "$BACKUP"
  [[ ! -e "$XRAY_CONFIG" ]] || cp -a "$XRAY_CONFIG" "$BACKUP/config.json"
  [[ ! -e "$XRAY_PUBLIC" ]] || cp -a "$XRAY_PUBLIC" "$BACKUP/reality-public.json"
  [[ ! -e "$XRAY_BIN" ]] || cp -a "$XRAY_BIN" "$BACKUP/xray"
  [[ ! -e "$XRAY_UNIT" ]] || cp -a "$XRAY_UNIT" "$BACKUP/xray.service"
  [[ ! -e "$PANEL_CONFIG" ]] || cp -a "$PANEL_CONFIG" "$BACKUP/panel-config.json"
  [[ ! -e "$COMPONENT_REGISTRY" ]] || cp -a "$COMPONENT_REGISTRY" "$BACKUP/components.json"
fi

XRAY_ADAPTER="$ADAPTER" XRAY_OUT="$WORK/config.json" XRAY_PORT="$PORT" \
XRAY_SERVER_NAME="$SERVER_NAME" XRAY_TARGET="$TARGET" XRAY_PRIVATE_KEY="$PRIVATE_KEY" \
XRAY_PUBLIC_KEY="$PUBLIC_KEY" XRAY_SHORT_ID="$SHORT_ID" node <<'NODE'
const fs = require('fs');
const { buildXrayRealityConfig } = require(process.env.XRAY_ADAPTER);
const config = buildXrayRealityConfig({
  port: Number(process.env.XRAY_PORT), serverName: process.env.XRAY_SERVER_NAME,
  target: process.env.XRAY_TARGET, privateKey: process.env.XRAY_PRIVATE_KEY,
  publicKey: process.env.XRAY_PUBLIC_KEY, shortId: process.env.XRAY_SHORT_ID,
}, []);
fs.writeFileSync(process.env.XRAY_OUT, JSON.stringify(config, null, 2), { mode: 0o600 });
NODE
"$WORK/unpacked/xray" run -test -config "$WORK/config.json" >/dev/null

id xray >/dev/null 2>&1 || useradd --system --home-dir /var/lib/xray --shell /usr/sbin/nologin xray
# The service runs as xray and config.json is root:xray 0640. The directory
# therefore needs group traversal; 0700 root:root makes a valid config
# unreadable and leaves systemd in a restart loop.
chown root:xray "$XRAY_DIR"
chmod 0750 "$XRAY_DIR"
install -m 0755 "$WORK/unpacked/xray" "${XRAY_BIN}.new"
mv "${XRAY_BIN}.new" "$XRAY_BIN"
install -o root -g xray -m 0640 "$WORK/config.json" "${XRAY_CONFIG}.new"
mv "${XRAY_CONFIG}.new" "$XRAY_CONFIG"
jq -n --arg version "$XRAY_VERSION" --arg serverName "$SERVER_NAME" --arg target "$TARGET" \
  --arg publicKey "$PUBLIC_KEY" --arg shortId "$SHORT_ID" --argjson port "$PORT" \
  '{version:$version,port:$port,serverName:$serverName,target:$target,publicKey:$publicKey,shortId:$shortId}' \
  > "${XRAY_PUBLIC}.new"
install -o root -g xray -m 0640 "${XRAY_PUBLIC}.new" "$XRAY_PUBLIC"
rm -f "${XRAY_PUBLIC}.new"

cat > "${XRAY_UNIT}.new" <<'UNIT'
[Unit]
Description=Xray VLESS REALITY
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=xray
Group=xray
ExecStart=/usr/local/bin/xray run -config /etc/xray/config.json
Restart=on-failure
RestartSec=3s
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
MemoryDenyWriteExecute=true
ReadWritePaths=/var/lib/xray

[Install]
WantedBy=multi-user.target
UNIT
chmod 644 "${XRAY_UNIT}.new"
mv "${XRAY_UNIT}.new" "$XRAY_UNIT"

rollback() {
  log "activation failed; restoring previous Xray state"
  systemctl stop xray >/dev/null 2>&1 || true
  if [[ -n "$BACKUP" ]]; then
    [[ ! -f "$BACKUP/xray" ]] || install -m 0755 "$BACKUP/xray" "$XRAY_BIN"
    [[ ! -f "$BACKUP/config.json" ]] || install -o root -g xray -m 0640 "$BACKUP/config.json" "$XRAY_CONFIG"
    [[ ! -f "$BACKUP/reality-public.json" ]] || install -o root -g xray -m 0640 "$BACKUP/reality-public.json" "$XRAY_PUBLIC"
    [[ ! -f "$BACKUP/xray.service" ]] || install -m 0644 "$BACKUP/xray.service" "$XRAY_UNIT"
    [[ ! -f "$BACKUP/panel-config.json" ]] || install -m 0600 "$BACKUP/panel-config.json" "$PANEL_CONFIG"
    [[ ! -f "$BACKUP/components.json" ]] || install -m 0644 "$BACKUP/components.json" "$COMPONENT_REGISTRY"
  fi
  (( HAD_BIN == 1 )) || rm -f "$XRAY_BIN"
  (( HAD_CONFIG == 1 )) || rm -f "$XRAY_CONFIG"
  (( HAD_PUBLIC == 1 )) || rm -f "$XRAY_PUBLIC"
  (( HAD_UNIT == 1 )) || rm -f "$XRAY_UNIT"
  (( HAD_PANEL_CONFIG == 1 )) || rm -f "$PANEL_CONFIG"
  (( HAD_REGISTRY == 1 )) || rm -f "$COMPONENT_REGISTRY"
  if (( HAD_DIR == 1 )); then
    chown "$XRAY_DIR_UID:$XRAY_DIR_GID" "$XRAY_DIR" 2>/dev/null || true
    chmod "$XRAY_DIR_MODE" "$XRAY_DIR" 2>/dev/null || true
  else
    chown root:root "$XRAY_DIR" 2>/dev/null || true
    chmod 0700 "$XRAY_DIR" 2>/dev/null || true
  fi
  systemctl daemon-reload
  if (( HAD_BIN == 1 && HAD_CONFIG == 1 && HAD_UNIT == 1 )); then
    systemctl restart xray >/dev/null 2>&1 || true
  fi
}

systemctl daemon-reload
service_stable=0
if systemctl enable --now xray >/dev/null 2>&1; then
  for _ in $(seq 1 15); do
    [[ "$(systemctl is-active xray 2>/dev/null || true)" == "active" ]] || { sleep 0.2; continue; }
    sleep 0.2
    [[ "$(systemctl is-active xray 2>/dev/null || true)" == "active" ]] && { service_stable=1; break; }
  done
fi
if (( service_stable != 1 )); then
  rollback
  die "xray.service failed health check; previous state restored"
fi

update_panel_metadata() {
  if [[ -f "$PANEL_CONFIG" ]]; then
    jq --argjson port "$PORT" --arg serverName "$SERVER_NAME" --arg target "$TARGET" \
    --arg publicKey "$PUBLIC_KEY" --arg shortId "$SHORT_ID" \
    '.stack = (.stack // {}) | .stack.vless = true | .vlessPort = $port |
     .vlessReality = {serverName:$serverName,target:$target,publicKey:$publicKey,shortId:$shortId}' \
      "$PANEL_CONFIG" > "${PANEL_CONFIG}.xray-new" || return 1
    chmod 600 "${PANEL_CONFIG}.xray-new" && mv "${PANEL_CONFIG}.xray-new" "$PANEL_CONFIG" || return 1
  fi
  if [[ -f "$COMPONENT_REGISTRY" ]]; then
    jq --arg version "$XRAY_VERSION" \
      '.components.vless = {installed:true,version:$version,path:"/usr/local/bin/xray",service:"xray.service"}' \
      "$COMPONENT_REGISTRY" > "${COMPONENT_REGISTRY}.xray-new" || return 1
    chmod 644 "${COMPONENT_REGISTRY}.xray-new" && \
      mv "${COMPONENT_REGISTRY}.xray-new" "$COMPONENT_REGISTRY" || return 1
  fi
}

if ! update_panel_metadata; then
  rm -f "${PANEL_CONFIG}.xray-new" "${COMPONENT_REGISTRY}.xray-new"
  rollback
  die "panel metadata update failed; previous state restored"
fi
if command -v ufw >/dev/null 2>&1; then
  ufw allow "$PORT/tcp" comment 'RIXXX VLESS REALITY' >/dev/null 2>&1 || true
fi

{
  echo "Xray VLESS REALITY installation report"
  echo "Version: $XRAY_VERSION"
  echo "Status: active"
  echo "TCP port: $PORT"
  echo "Server name: $SERVER_NAME"
  echo "Target: $TARGET"
  echo "Public key: $PUBLIC_KEY"
  echo "Short ID: $SHORT_ID"
  echo "Private key: stored only in $XRAY_CONFIG"
  echo "Backup: ${BACKUP:-none (first install)}"
  echo "Next step: create VLESS-enabled users from the panel after Stage C is installed."
} > "$REPORT"
chmod 600 "$REPORT"
log "installed and active; report: $REPORT"
