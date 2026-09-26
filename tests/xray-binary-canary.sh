#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
INSTALLER="$ROOT/panel/scripts/install_xray.sh"
ADAPTER="$ROOT/panel/server/xrayConfig.js"
read_pin() { sed -nE "s/^$1=\"([^\"]+)\"/\\1/p" "$INSTALLER" | head -n1; }
VERSION=$(read_pin XRAY_VERSION)
ASSET=$(read_pin XRAY_ASSET)
SHA256=$(read_pin XRAY_SHA256)
[[ -n "$VERSION" && -n "$ASSET" && -n "$SHA256" ]] || {
  echo "could not read pinned Xray metadata" >&2; exit 1;
}

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
ARCHIVE="$WORK/$ASSET"
URL="https://github.com/XTLS/Xray-core/releases/download/${VERSION}/${ASSET}"
curl -fL --retry 3 --connect-timeout 15 "$URL" -o "$ARCHIVE"
printf '%s  %s\n' "$SHA256" "$ARCHIVE" | sha256sum -c -
unzip -q "$ARCHIVE" xray -d "$WORK"
"$WORK/xray" version | grep -F "${VERSION#v}" >/dev/null

KEYS=$("$WORK/xray" x25519)
PRIVATE_KEY=$(printf '%s\n' "$KEYS" | sed -nE 's/^Private key:[[:space:]]*//p' | head -n1)
PUBLIC_KEY=$(printf '%s\n' "$KEYS" | sed -nE 's/^Public key:[[:space:]]*//p' | head -n1)
[[ -n "$PRIVATE_KEY" && -n "$PUBLIC_KEY" ]] || {
  echo "pinned binary did not emit the expected X25519 key format" >&2; exit 1;
}

XRAY_ADAPTER="$ADAPTER" XRAY_OUT="$WORK/config.json" \
XRAY_PRIVATE_KEY="$PRIVATE_KEY" XRAY_PUBLIC_KEY="$PUBLIC_KEY" node <<'NODE'
const fs = require('fs');
const { buildXrayRealityConfig } = require(process.env.XRAY_ADAPTER);
const config = buildXrayRealityConfig({
  port: 18443,
  serverName: 'www.microsoft.com',
  target: 'www.microsoft.com:443',
  privateKey: process.env.XRAY_PRIVATE_KEY,
  publicKey: process.env.XRAY_PUBLIC_KEY,
  shortId: '0123456789abcdef',
}, [{ id: '11111111-1111-4111-8111-111111111111', email: 'canary-user' }]);
fs.writeFileSync(process.env.XRAY_OUT, JSON.stringify(config, null, 2));
NODE
"$WORK/xray" run -test -config "$WORK/config.json"
echo "Pinned Xray binary canary passed: $VERSION on $(. /etc/os-release; echo "$PRETTY_NAME")"
