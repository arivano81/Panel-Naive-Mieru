#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
INSTALLER="$SCRIPT_DIR/install_xray.sh"
read_pin() { sed -nE "s/^$1=\"([^\"]+)\"/\1/p" "$INSTALLER" | head -n1; }
VERSION=$(read_pin XRAY_VERSION)
ASSET=$(read_pin XRAY_ASSET)
SHA256=$(read_pin XRAY_SHA256)
BIN=/usr/local/bin/xray
CONFIG=/etc/xray/config.json
PUBLIC=/etc/xray/reality-public.json
REGISTRY=/etc/rixxx-panel/components.json

die() { echo "[XRAY UPDATE] ERROR: $*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die 'run as root'
[[ -x "$BIN" && -f "$CONFIG" ]] || die 'installed Xray and config are required'
for command in curl unzip sha256sum jq systemctl; do command -v "$command" >/dev/null || die "missing $command"; done

if "$BIN" version | head -n1 | grep -F "${VERSION#v}" >/dev/null; then
  echo "[XRAY UPDATE] Xray $VERSION is already installed"
  exit 0
fi

WORK=$(mktemp -d)
BACKUP="/etc/xray/backups/binary-$(date -u +%Y%m%dT%H%M%SZ)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/unpacked" "$BACKUP"
chmod 700 "$BACKUP"
URL="https://github.com/XTLS/Xray-core/releases/download/${VERSION}/${ASSET}"
curl -fL --retry 3 --connect-timeout 15 "$URL" -o "$WORK/$ASSET"
printf '%s  %s\n' "$SHA256" "$WORK/$ASSET" | sha256sum -c --status - \
  || die 'SHA-256 mismatch; running installation was not changed'
unzip -q "$WORK/$ASSET" xray -d "$WORK/unpacked"
CANDIDATE="$WORK/unpacked/xray"
chmod 755 "$CANDIDATE"
"$CANDIDATE" version | head -n1 | grep -F "${VERSION#v}" >/dev/null \
  || die 'candidate version mismatch'
"$CANDIDATE" run -test -config "$CONFIG" >/dev/null \
  || die 'current production config is incompatible with the candidate'

cp -a "$BIN" "$BACKUP/xray"
[[ ! -f "$PUBLIC" ]] || cp -a "$PUBLIC" "$BACKUP/reality-public.json"
[[ ! -f "$REGISTRY" ]] || cp -a "$REGISTRY" "$BACKUP/components.json"
if [[ -f "$PUBLIC" ]]; then
  jq --arg version "$VERSION" '.version = $version' "$PUBLIC" > "$WORK/reality-public.json"
fi
if [[ -f "$REGISTRY" ]]; then
  jq --arg version "$VERSION" '.components.vless.version = $version' "$REGISTRY" > "$WORK/components.json"
fi

rollback() {
  install -m 0755 "$BACKUP/xray" "$BIN"
  [[ ! -f "$BACKUP/reality-public.json" ]] || cp -a "$BACKUP/reality-public.json" "$PUBLIC"
  [[ ! -f "$BACKUP/components.json" ]] || cp -a "$BACKUP/components.json" "$REGISTRY"
  systemctl restart xray >/dev/null 2>&1 || true
}

install -m 0755 "$CANDIDATE" "${BIN}.new"
mv "${BIN}.new" "$BIN"
if ! systemctl restart xray || ! systemctl is-active --quiet xray; then
  rollback
  die 'candidate failed to start; previous binary restored'
fi
sleep 3
if [[ "$(systemctl show xray -p ActiveState --value)" != active ]]; then
  rollback
  die 'candidate did not remain active; previous binary restored'
fi

if ! { [[ ! -f "$WORK/reality-public.json" ]] || install -o root -g xray -m 0640 "$WORK/reality-public.json" "$PUBLIC"; } ||
   ! { [[ ! -f "$WORK/components.json" ]] || install -m 0644 "$WORK/components.json" "$REGISTRY"; }; then
  rollback
  die 'metadata update failed; previous binary and metadata restored'
fi

echo "[XRAY UPDATE] Updated to $VERSION without changing config, REALITY keys or user UUIDs"
