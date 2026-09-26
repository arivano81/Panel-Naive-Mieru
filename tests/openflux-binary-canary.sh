#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
INSTALLER="$ROOT/panel/scripts/install_openflux.sh"
ADAPTER="$ROOT/panel/server/openfluxAdapter.js"
read_pin() { sed -nE "s/^$1=\"([^\"]+)\"/\\1/p" "$INSTALLER" | head -n1; }
VERSION=$(read_pin OPENFLUX_VERSION)
ASSET=$(read_pin OPENFLUX_ASSET)
SHA256=$(read_pin OPENFLUX_SHA256)
[[ -n "$VERSION" && -n "$ASSET" && -n "$SHA256" ]] || {
  echo "could not read pinned OpenFlux metadata" >&2; exit 1;
}

WORK=$(mktemp -d)
PIDS=()
cleanup() {
  local status=$?
  trap - EXIT
  for pid in "${PIDS[@]}"; do kill "$pid" >/dev/null 2>&1 || true; done
  wait >/dev/null 2>&1 || true
  if (( status != 0 )); then
    for log in "$WORK"/*.log; do
      [[ ! -f "$log" ]] || { echo "=== $(basename "$log") ===" >&2; tail -n 40 "$log" >&2; }
    done
  fi
  rm -rf "$WORK"
  exit "$status"
}
trap cleanup EXIT

URL="https://github.com/p1neappleXpress/OpenFlux/releases/download/${VERSION}/${ASSET}"
curl -fL --retry 3 --connect-timeout 15 "$URL" -o "$WORK/openflux"
printf '%s  %s\n' "$SHA256" "$WORK/openflux" | sha256sum -c -
chmod 0755 "$WORK/openflux"
"$WORK/openflux" --help 2>&1 | grep -F OpenFlux >/dev/null

openssl rand -base64 48 > "$WORK/server.key"
cp "$WORK/server.key" "$WORK/client.key"
openssl rand -base64 48 > "$WORK/wrong.key"
chmod 0600 "$WORK"/*.key

OPENFLUX_ADAPTER="$ADAPTER" OPENFLUX_WORK="$WORK" node <<'NODE'
const fs = require('fs');
const { buildOpenFluxExitConfig, buildOpenFluxClientConfig } = require(process.env.OPENFLUX_ADAPTER);
const profile = { id: 'ci-canary', port: 18445, host: '127.0.0.1', socksPort: 11080 };
const exit = buildOpenFluxExitConfig(profile).replace('/etc/openflux/secrets/ci-canary.key', `${process.env.OPENFLUX_WORK}/server.key`);
const client = buildOpenFluxClientConfig(profile).replace('./openflux.key', `${process.env.OPENFLUX_WORK}/client.key`);
const wrong = buildOpenFluxClientConfig({ ...profile, socksPort: 11081 }).replace('./openflux.key', `${process.env.OPENFLUX_WORK}/wrong.key`);
fs.writeFileSync(`${process.env.OPENFLUX_WORK}/exit.conf`, exit);
fs.writeFileSync(`${process.env.OPENFLUX_WORK}/client.conf`, client);
fs.writeFileSync(`${process.env.OPENFLUX_WORK}/wrong.conf`, wrong);
NODE

OPENFLUX_WORK="$WORK" node <<'NODE' > "$WORK/http.log" 2>&1 &
const http = require('http');
http.createServer((_req, res) => res.end('openflux-canary-ok')).listen(19090, '127.0.0.1');
NODE
PIDS+=("$!")
"$WORK/openflux" --config="$WORK/exit.conf" > "$WORK/exit.log" 2>&1 & PIDS+=("$!")
"$WORK/openflux" --config="$WORK/client.conf" > "$WORK/client.log" 2>&1 & PIDS+=("$!")

wait_for_port() {
  local port=$1
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 1 "http://127.0.0.1:$port" >/dev/null 2>&1; then return 0; fi
    sleep 0.25
  done
  return 1
}
wait_for_port 19090

RESULT=""
for _ in $(seq 1 80); do
  RESULT=$(curl -fsS --max-time 2 --socks5-hostname 127.0.0.1:11080 \
    http://127.0.0.1:19090 2>/dev/null || true)
  [[ "$RESULT" != "openflux-canary-ok" ]] || break
  sleep 0.25
done
[[ "$RESULT" == "openflux-canary-ok" ]] || { echo "encrypted Direct tunnel failed" >&2; exit 1; }

"$WORK/openflux" --config="$WORK/wrong.conf" > "$WORK/wrong.log" 2>&1 & PIDS+=("$!")
sleep 1
if curl -fsS --max-time 3 --socks5-hostname 127.0.0.1:11081 \
  http://127.0.0.1:19090 >/dev/null 2>&1; then
  echo "wrong encryption key unexpectedly reached the target" >&2
  exit 1
fi

echo "OpenFlux encrypted L4/Direct canary passed: $VERSION on $(. /etc/os-release; echo "$PRETTY_NAME")"
