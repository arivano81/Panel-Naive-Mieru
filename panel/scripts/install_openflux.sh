#!/usr/bin/env bash
set -euo pipefail

OPENFLUX_VERSION="0.0.5"
OPENFLUX_ASSET="openflux-linux-amd64"
OPENFLUX_SHA256="8211dd5343dd4eac49fcd2838ffcb9e1912c14a0e878c735395967999b0573c5"
OPENFLUX_URL="https://github.com/p1neappleXpress/OpenFlux/releases/download/${OPENFLUX_VERSION}/${OPENFLUX_ASSET}"
OPENFLUX_BIN="/usr/local/bin/openflux"
OPENFLUX_DIR="/etc/openflux"
OPENFLUX_UNIT="/etc/systemd/system/openflux-exit@.service"
COMPONENT_REGISTRY="/etc/rixxx-panel/components.json"
REPORT="/root/rixxx-openflux-install-report.txt"

log() { printf '[OPENFLUX] %s\n' "$*"; }
die() { printf '[OPENFLUX] ERROR: %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run as root"
[[ "$(uname -m)" == "x86_64" || "$(uname -m)" == "amd64" ]] || die "only amd64 is supported"
for command in curl sha256sum node systemctl jq; do
  command -v "$command" >/dev/null 2>&1 || die "missing dependency: $command"
done
[[ ! -f "$COMPONENT_REGISTRY" ]] || jq empty "$COMPONENT_REGISTRY" >/dev/null 2>&1 \
  || die "component registry is invalid JSON"

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ADAPTER="$SCRIPT_DIR/../server/openfluxAdapter.js"
[[ -f "$ADAPTER" ]] || die "missing OpenFlux adapter: $ADAPTER"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
COMMITTED=0
HAD_BIN=0; HAD_UNIT=0; HAD_REGISTRY=0
[[ ! -e "$OPENFLUX_BIN" ]] || HAD_BIN=1
[[ ! -e "$OPENFLUX_UNIT" ]] || HAD_UNIT=1
[[ ! -e "$COMPONENT_REGISTRY" ]] || HAD_REGISTRY=1

log "downloading pinned OpenFlux ${OPENFLUX_VERSION}"
curl -fL --retry 3 --connect-timeout 15 "$OPENFLUX_URL" -o "$WORK/$OPENFLUX_ASSET"
printf '%s  %s\n' "$OPENFLUX_SHA256" "$WORK/$OPENFLUX_ASSET" | sha256sum -c - >/dev/null \
  || die "SHA-256 mismatch; nothing was installed"
chmod 0755 "$WORK/$OPENFLUX_ASSET"
"$WORK/$OPENFLUX_ASSET" --help 2>&1 | grep -F 'OpenFlux' >/dev/null \
  || die "downloaded binary failed the identity smoke test"

OPENFLUX_ADAPTER="$ADAPTER" node <<'NODE' > "$WORK/openflux-exit@.service"
const { buildOpenFluxUnit } = require(process.env.OPENFLUX_ADAPTER);
process.stdout.write(buildOpenFluxUnit());
NODE
grep -F 'ExecStart=/usr/local/bin/openflux --config=/etc/openflux/profiles/%i.conf' \
  "$WORK/openflux-exit@.service" >/dev/null || die "generated unit failed validation"

BACKUP=""
if [[ -e "$OPENFLUX_BIN" || -e "$OPENFLUX_UNIT" || -e "$COMPONENT_REGISTRY" ]]; then
  BACKUP="$OPENFLUX_DIR/backups/$(date +%Y-%m-%d-%H%M%S)"
  mkdir -p "$BACKUP"
  chmod 0700 "$BACKUP"
  [[ ! -e "$OPENFLUX_BIN" ]] || cp -a "$OPENFLUX_BIN" "$BACKUP/openflux"
  [[ ! -e "$OPENFLUX_UNIT" ]] || cp -a "$OPENFLUX_UNIT" "$BACKUP/openflux-exit@.service"
  [[ ! -e "$COMPONENT_REGISTRY" ]] || cp -a "$COMPONENT_REGISTRY" "$BACKUP/components.json"
fi

rollback() {
  log "installation failed; restoring previous OpenFlux files"
  if [[ -n "$BACKUP" ]]; then
    [[ ! -f "$BACKUP/openflux" ]] || install -m 0755 "$BACKUP/openflux" "$OPENFLUX_BIN"
    [[ ! -f "$BACKUP/openflux-exit@.service" ]] || \
      install -m 0644 "$BACKUP/openflux-exit@.service" "$OPENFLUX_UNIT"
    [[ ! -f "$BACKUP/components.json" ]] || \
      install -m 0644 "$BACKUP/components.json" "$COMPONENT_REGISTRY"
  fi
  (( HAD_BIN == 1 )) || rm -f "$OPENFLUX_BIN"
  (( HAD_UNIT == 1 )) || rm -f "$OPENFLUX_UNIT"
  (( HAD_REGISTRY == 1 )) || rm -f "$COMPONENT_REGISTRY"
  rm -f "${OPENFLUX_BIN}.new" "${OPENFLUX_UNIT}.new" "${COMPONENT_REGISTRY}.openflux-new"
  systemctl daemon-reload >/dev/null 2>&1 || true
}

cleanup() {
  local status=$?
  trap - EXIT
  if (( status != 0 && COMMITTED == 0 )); then rollback; fi
  rm -rf "$WORK"
  exit "$status"
}
trap cleanup EXIT

id openflux >/dev/null 2>&1 || useradd --system --home-dir /var/lib/openflux --shell /usr/sbin/nologin openflux
install -d -o root -g openflux -m 0750 "$OPENFLUX_DIR" "$OPENFLUX_DIR/profiles"
install -d -o openflux -g openflux -m 0700 "$OPENFLUX_DIR/secrets"
install -d -o openflux -g openflux -m 0750 /var/lib/openflux
install -m 0755 "$WORK/$OPENFLUX_ASSET" "${OPENFLUX_BIN}.new"
mv "${OPENFLUX_BIN}.new" "$OPENFLUX_BIN"
install -m 0644 "$WORK/openflux-exit@.service" "${OPENFLUX_UNIT}.new"
mv "${OPENFLUX_UNIT}.new" "$OPENFLUX_UNIT"

if [[ -f "$COMPONENT_REGISTRY" ]]; then
  jq --arg version "$OPENFLUX_VERSION" \
    '.components.openflux = {installed:true,version:$version,path:"/usr/local/bin/openflux",service:"openflux-exit@.service",enabled:false}' \
    "$COMPONENT_REGISTRY" > "${COMPONENT_REGISTRY}.openflux-new" \
    || die "could not update component registry"
  chmod 0644 "${COMPONENT_REGISTRY}.openflux-new"
  mv "${COMPONENT_REGISTRY}.openflux-new" "$COMPONENT_REGISTRY"
fi

systemctl daemon-reload
{
  echo "OpenFlux Experimental installation report"
  echo "Version: $OPENFLUX_VERSION"
  echo "Binary checksum: $OPENFLUX_SHA256"
  echo "Status: installed, disabled, no profiles"
  echo "Opened ports: none"
  echo "Started services: none"
  echo "Source: https://github.com/p1neappleXpress/OpenFlux/tree/$OPENFLUX_VERSION"
  echo "License: GPL-3.0-or-later"
  echo "Backup: ${BACKUP:-none (first install)}"
  echo "Next step: isolated Debian 13 canary; do not use on a production server yet."
} > "$REPORT"
chmod 0600 "$REPORT"
COMMITTED=1
log "installed but not enabled; no service was started and no port was opened"
log "report: $REPORT"
