#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
read_pin() { sed -nE "s/^$1=\"([^\"]+)\"/\1/p" "$ROOT/install.sh" | head -n1; }
VERSION=$(read_pin CADDY_NAIVE_VERSION)
BASE_VERSION=${VERSION%%-naive*}
SHA256=$(read_pin CADDY_NAIVE_SHA256)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
ARCHIVE="$WORK/caddy.tar.xz"
URL="https://github.com/klzgrad/forwardproxy/releases/download/${VERSION}/caddy-forwardproxy-naive.tar.xz"

curl -fL --retry 3 --connect-timeout 15 "$URL" -o "$ARCHIVE"
printf '%s  %s\n' "$SHA256" "$ARCHIVE" | sha256sum -c --status -
tar -xJf "$ARCHIVE" -C "$WORK"
BIN=$(find "$WORK" -type f \( -name caddy -o -name caddy-naive -o -name caddy-forwardproxy-naive \) -print -quit)
[[ -n "$BIN" ]] || { echo 'Caddy binary not found in archive' >&2; exit 1; }
chmod 755 "$BIN"
"$BIN" version | grep -F "${BASE_VERSION#v}" >/dev/null
"$BIN" list-modules | grep -Fx 'http.handlers.forward_proxy' >/dev/null
cat > "$WORK/Caddyfile" <<'EOF'
{
  admin off
  auto_https off
}
:18081 {
  forward_proxy {
    basic_auth canary canary-password
    hide_ip
    hide_via
    probe_resistance
  }
}
EOF
"$BIN" validate --config "$WORK/Caddyfile" --adapter caddyfile >/dev/null
echo "Pinned Caddy forwardproxy canary passed: $VERSION on $(. /etc/os-release; echo "$PRETTY_NAME")"
