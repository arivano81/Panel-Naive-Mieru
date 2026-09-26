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
PIDS=()
cleanup() {
  if ((${#PIDS[@]})); then kill "${PIDS[@]}" 2>/dev/null || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT
ARCHIVE="$WORK/$ASSET"
URL="https://github.com/XTLS/Xray-core/releases/download/${VERSION}/${ASSET}"
curl -fL --retry 3 --connect-timeout 15 "$URL" -o "$ARCHIVE"
printf '%s  %s\n' "$SHA256" "$ARCHIVE" | sha256sum -c -
unzip -q "$ARCHIVE" xray -d "$WORK"
"$WORK/xray" version | grep -F "${VERSION#v}" >/dev/null

KEYS=$("$WORK/xray" x25519)
PRIVATE_KEY=$(printf '%s\n' "$KEYS" | sed -nE 's/^(PrivateKey|Private key):[[:space:]]*//p' | head -n1)
PUBLIC_KEY=$(printf '%s\n' "$KEYS" | sed -nE 's/^(Password \(PublicKey\)|Password|Public key):[[:space:]]*//p' | head -n1)
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
}, [{ id: '11111111-1111-4111-8111-111111111111', email: 'canary-user' }], {
  enabled: true, port: 10443, host: 'vpn.example.com', path: '/xhttp_canary_0123456789',
});
fs.writeFileSync(process.env.XRAY_OUT, JSON.stringify(config, null, 2));
NODE
"$WORK/xray" run -test -config "$WORK/config.json"

# End-to-end REALITY canary: a local TLS decoy satisfies the REALITY target,
# the pinned binary runs both server and client, and curl reaches a separate
# HTTP origin only through the client's SOCKS5 inbound and VLESS tunnel.
command -v openssl >/dev/null || { echo "openssl is required for the REALITY canary" >&2; exit 1; }
printf '127.0.0.1 canary.example.test\n' >> /etc/hosts
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=canary.example.test' \
  -keyout "$WORK/decoy.key" -out "$WORK/decoy.crt" >/dev/null 2>&1
openssl s_server -quiet -accept 127.0.0.1:443 -key "$WORK/decoy.key" -cert "$WORK/decoy.crt" \
  >"$WORK/decoy.log" 2>&1 & PIDS+=("$!")
node -e "require('http').createServer((q,r)=>r.end('vless-reality-canary')).listen(19080,'127.0.0.1')" \
  >"$WORK/origin.log" 2>&1 & PIDS+=("$!")

XRAY_ADAPTER="$ADAPTER" XRAY_SERVER_OUT="$WORK/server.json" XRAY_CLIENT_OUT="$WORK/client.json" \
XRAY_PRIVATE_KEY="$PRIVATE_KEY" XRAY_PUBLIC_KEY="$PUBLIC_KEY" node <<'NODE'
const fs = require('fs');
const { buildXrayRealityConfig } = require(process.env.XRAY_ADAPTER);
const id = '11111111-1111-4111-8111-111111111111';
const settings = {
  port: 18443, serverName: 'canary.example.test', target: 'canary.example.test:443',
  privateKey: process.env.XRAY_PRIVATE_KEY, publicKey: process.env.XRAY_PUBLIC_KEY,
  shortId: '0123456789abcdef',
};
fs.writeFileSync(process.env.XRAY_SERVER_OUT, JSON.stringify(
  buildXrayRealityConfig(settings, [{ id, email: 'canary-user' }]), null, 2));
fs.writeFileSync(process.env.XRAY_CLIENT_OUT, JSON.stringify({
  log: { loglevel: 'warning' },
  inbounds: [{ listen: '127.0.0.1', port: 18080, protocol: 'socks', settings: { udp: false } }],
  outbounds: [{ protocol: 'vless', settings: { vnext: [{ address: '127.0.0.1', port: 18443,
    users: [{ id, encryption: 'none', flow: 'xtls-rprx-vision' }] }] }, streamSettings: {
      network: 'tcp', security: 'reality', realitySettings: {
        serverName: settings.serverName, fingerprint: 'chrome', password: settings.publicKey,
        shortId: settings.shortId, spiderX: '/',
      },
    } }],
}, null, 2));
NODE
"$WORK/xray" run -test -config "$WORK/server.json"
"$WORK/xray" run -test -config "$WORK/client.json"
"$WORK/xray" run -config "$WORK/server.json" >"$WORK/server.log" 2>&1 & PIDS+=("$!")
"$WORK/xray" run -config "$WORK/client.json" >"$WORK/client.log" 2>&1 & PIDS+=("$!")

CANARY_OK=0
for _ in $(seq 1 40); do
  if [[ "$(curl -fsS --max-time 2 --socks5-hostname 127.0.0.1:18080 \
      http://127.0.0.1:19080/canary 2>/dev/null || true)" == 'vless-reality-canary' ]]; then
    CANARY_OK=1
    break
  fi
  sleep 0.25
done
if [[ "$CANARY_OK" != 1 ]]; then
  echo 'REALITY end-to-end client canary failed' >&2
  tail -n 50 "$WORK/server.log" "$WORK/client.log" "$WORK/decoy.log" "$WORK/origin.log" >&2 || true
  exit 1
fi
echo "Pinned Xray binary canary passed: $VERSION on $(. /etc/os-release; echo "$PRETTY_NAME")"
