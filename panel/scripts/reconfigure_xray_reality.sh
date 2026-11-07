#!/usr/bin/env bash
set -euo pipefail

PANEL_CONFIG="/etc/rixxx-panel/config.json"
XRAY_CONFIG="/etc/xray/config.json"
XRAY_PUBLIC="/etc/xray/reality-public.json"
XRAY_BIN="/usr/local/bin/xray"
REPORT="/root/rixxx-xray-reality-target-report.txt"
MODE="apply"
if [[ "${1:-}" == "--check" ]]; then MODE="check"; shift; fi
SERVER_NAME="${1:-}"

die() { printf '[XRAY-TARGET] ERROR: %s\n' "$*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "run as root"
for command in jq openssl systemctl install cp timeout; do
  command -v "$command" >/dev/null 2>&1 || die "missing dependency: $command"
done
[[ -f "$PANEL_CONFIG" && -f "$XRAY_CONFIG" && -x "$XRAY_BIN" ]] || die "managed Xray is not installed"
HAD_PUBLIC=0
[[ ! -f "$XRAY_PUBLIC" ]] || HAD_PUBLIC=1

PRIMARY_DOMAIN=$(jq -r '.domain // empty' "$PANEL_CONFIG")
[[ -n "$PRIMARY_DOMAIN" ]] || die "primary panel domain is not configured"
[[ -n "$SERVER_NAME" ]] || SERVER_NAME="$PRIMARY_DOMAIN"
[[ "$SERVER_NAME" == "$PRIMARY_DOMAIN" ]] || die "REALITY target must be the configured primary domain: $PRIMARY_DOMAIN"
TARGET="${SERVER_NAME}:443"

# Require the exact local TLS identity before changing a live profile. Connecting
# to loopback avoids hairpin-NAT assumptions while SNI and hostname verification
# still prove that Caddy owns a valid certificate for the configured domain.
TLS_CERT=$(mktemp)
WORK=$(mktemp -d)
trap 'rm -f "$TLS_CERT"; rm -rf "$WORK"' EXIT
if ! timeout 12 openssl s_client -connect 127.0.0.1:443 -servername "$SERVER_NAME" \
    -verify_hostname "$SERVER_NAME" -verify_return_error </dev/null 2>/dev/null \
    | openssl x509 -out "$TLS_CERT" 2>/dev/null; then
  die "the local TLS certificate for $SERVER_NAME:443 is unavailable or untrusted"
fi
openssl x509 -in "$TLS_CERT" -noout -checkend 86400 >/dev/null \
  || die "the TLS certificate for $SERVER_NAME expires within 24 hours"

jq --arg name "$SERVER_NAME" --arg target "$TARGET" '
  (.inbounds[] | select(.tag == "vless-reality-in") |
    .streamSettings.realitySettings.dest) = $target |
  (.inbounds[] | select(.tag == "vless-reality-in") |
    .streamSettings.realitySettings.serverNames) = [$name]
' "$XRAY_CONFIG" > "$WORK/config.json"
jq --arg name "$SERVER_NAME" --arg target "$TARGET" '
  .vlessReality.serverName = $name | .vlessReality.target = $target
' "$PANEL_CONFIG" > "$WORK/panel-config.json"
if [[ -f "$XRAY_PUBLIC" ]]; then
  jq --arg name "$SERVER_NAME" --arg target "$TARGET" \
    '.serverName = $name | .target = $target' "$XRAY_PUBLIC" > "$WORK/reality-public.json"
fi

"$XRAY_BIN" run -test -format json -config "$WORK/config.json" >/dev/null
CADDY_PID=$(systemctl show caddy-naive --property=MainPID --value)
[[ "$(systemctl is-active caddy-naive)" == active && "$CADDY_PID" != 0 ]] \
  || die "caddy-naive must be active before the isolated Xray change"
if [[ "$MODE" == check ]]; then
  jq -n --arg serverName "$SERVER_NAME" --arg target "$TARGET" \
    '{ok:true,checkOnly:true,serverName:$serverName,target:$target,keysPreserved:true,naiveRestarted:false}'
  exit 0
fi

BACKUP="/etc/xray/backups/target-$(date +%Y-%m-%d-%H%M%S)"
mkdir -p "$BACKUP"
chmod 700 "$BACKUP"
cp -a "$XRAY_CONFIG" "$BACKUP/config.json"
cp -a "$PANEL_CONFIG" "$BACKUP/panel-config.json"
[[ ! -f "$XRAY_PUBLIC" ]] || cp -a "$XRAY_PUBLIC" "$BACKUP/reality-public.json"

rollback() {
  install -o root -g xray -m 0640 "$BACKUP/config.json" "$XRAY_CONFIG"
  install -o root -g root -m 0600 "$BACKUP/panel-config.json" "$PANEL_CONFIG"
  [[ ! -f "$BACKUP/reality-public.json" ]] || \
    install -o root -g xray -m 0640 "$BACKUP/reality-public.json" "$XRAY_PUBLIC"
  (( HAD_PUBLIC == 1 )) || rm -f "$XRAY_PUBLIC"
  systemctl restart xray >/dev/null 2>&1 || true
}

install_ok=1
install -o root -g xray -m 0640 "$WORK/config.json" "$XRAY_CONFIG" || install_ok=0
install -o root -g root -m 0600 "$WORK/panel-config.json" "$PANEL_CONFIG" || install_ok=0
if [[ -f "$WORK/reality-public.json" ]]; then
  install -o root -g xray -m 0640 "$WORK/reality-public.json" "$XRAY_PUBLIC" || install_ok=0
fi
if (( install_ok != 1 )); then
  rollback
  die "could not atomically install the target metadata; previous state restored"
fi

if ! systemctl restart xray || ! sleep 1 || [[ "$(systemctl is-active xray)" != active ]]; then
  rollback
  die "Xray rejected the new target; previous configuration restored"
fi
if [[ "$(systemctl is-active caddy-naive)" != active ]] || \
   [[ "$(systemctl show caddy-naive --property=MainPID --value)" != "$CADDY_PID" ]]; then
  rollback
  die "caddy-naive changed during the isolated operation; Xray configuration restored"
fi

{
  echo "Xray REALITY target change"
  echo "Status: active"
  echo "Server name: $SERVER_NAME"
  echo "Target: $TARGET"
  echo "Keys and client UUIDs: preserved"
  echo "caddy-naive PID: $CADDY_PID (unchanged)"
  echo "Backup: $BACKUP"
} > "$REPORT"
chmod 600 "$REPORT"
jq -n --arg serverName "$SERVER_NAME" --arg target "$TARGET" --arg backup "$BACKUP" \
  '{ok:true,serverName:$serverName,target:$target,keysPreserved:true,naiveRestarted:false,backup:$backup}'
