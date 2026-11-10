#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PIN_SOURCE="$SCRIPT_DIR/../../install.sh"
[[ -f "$PIN_SOURCE" ]] || PIN_SOURCE="$SCRIPT_DIR/../install.sh"
read_pin() { sed -nE "s/^$1=\"([^\"]+)\"/\1/p" "$PIN_SOURCE" | head -n1; }
VERSION=$(read_pin CADDY_NAIVE_VERSION)
SHA256=$(read_pin CADDY_NAIVE_SHA256)
BASE_VERSION=${VERSION%%-naive*}
BIN=/usr/local/bin/caddy-naive
CONFIG=/etc/caddy-naive/Caddyfile
REGISTRY=/etc/rixxx-panel/components.json

die() { echo "[CADDY UPDATE] ERROR: $*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die 'run as root'
[[ -x "$BIN" && -f "$CONFIG" ]] || die 'installed Caddy and Caddyfile are required'
for command in curl sha256sum tar jq systemctl setcap ss; do command -v "$command" >/dev/null || die "missing $command"; done

if [[ "$("$BIN" version 2>/dev/null | sed -n '1p')" == *"${BASE_VERSION#v}"* ]]; then
  echo "[CADDY UPDATE] Caddy $VERSION is already installed"
  exit 0
fi

WORK=$(mktemp -d)
BACKUP="/etc/caddy-naive/backups/binary-$(date -u +%Y%m%dT%H%M%SZ)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$BACKUP"
chmod 700 "$BACKUP"
ARCHIVE="$WORK/caddy-forwardproxy-naive.tar.xz"
URL="https://github.com/klzgrad/forwardproxy/releases/download/${VERSION}/caddy-forwardproxy-naive.tar.xz"
curl -fL --retry 3 --connect-timeout 15 "$URL" -o "$ARCHIVE"
printf '%s  %s\n' "$SHA256" "$ARCHIVE" | sha256sum -c --status - \
  || die 'SHA-256 mismatch; running installation was not changed'
tar -xJf "$ARCHIVE" -C "$WORK"
CANDIDATE=$(find "$WORK" -type f \( -name caddy -o -name caddy-naive -o -name caddy-forwardproxy-naive \) -print -quit)
[[ -n "$CANDIDATE" ]] || die 'candidate binary not found'
chmod 755 "$CANDIDATE"
[[ "$("$CANDIDATE" version 2>/dev/null | sed -n '1p')" == *"${BASE_VERSION#v}"* ]] \
  || die 'candidate version mismatch'
"$CANDIDATE" list-modules | grep -Fx 'http.handlers.forward_proxy' >/dev/null \
  || die 'candidate has no forward_proxy module'
"$CANDIDATE" validate --config "$CONFIG" --adapter caddyfile >/dev/null \
  || die 'current production Caddyfile is incompatible with the candidate'

cp -a "$BIN" "$BACKUP/caddy-naive"
[[ ! -f "$REGISTRY" ]] || cp -a "$REGISTRY" "$BACKUP/components.json"
if [[ -f "$REGISTRY" ]]; then
  jq --arg version "$VERSION" '.components.caddyNaive.version = $version' "$REGISTRY" > "$WORK/components.json"
fi

rollback() {
  install -o root -g caddy -m 0755 "$BACKUP/caddy-naive" "$BIN"
  setcap 'cap_net_bind_service=+ep' "$BIN"
  [[ ! -f "$BACKUP/components.json" ]] || cp -a "$BACKUP/components.json" "$REGISTRY"
  systemctl restart caddy-naive >/dev/null 2>&1 || true
}

install -o root -g caddy -m 0755 "$CANDIDATE" "${BIN}.new"
setcap 'cap_net_bind_service=+ep' "${BIN}.new"
mv "${BIN}.new" "$BIN"
if ! systemctl restart caddy-naive || ! systemctl is-active --quiet caddy-naive; then
  rollback
  die 'candidate failed to start; previous binary restored'
fi
sleep 3
if [[ "$(systemctl show caddy-naive -p ActiveState --value)" != active ]] ||
   ! ss -H -ltn 'sport = :443' | grep -q .; then
  rollback
  die 'candidate did not remain healthy; previous binary restored'
fi
if ! { [[ ! -f "$WORK/components.json" ]] || install -m 0644 "$WORK/components.json" "$REGISTRY"; }; then
  rollback
  die 'metadata update failed; previous binary and metadata restored'
fi

echo "[CADDY UPDATE] Updated to $VERSION without changing the Caddyfile"
