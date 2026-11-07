#!/usr/bin/env bash
set -euo pipefail

OPENFLUX_BIN="/usr/local/bin/openflux"
OPENFLUX_DIR="/etc/openflux"
PROFILE_DIR="$OPENFLUX_DIR/profiles"
SECRET_DIR="$OPENFLUX_DIR/secrets"
UNIT="/etc/systemd/system/openflux-exit@.service"
REGISTRY="/etc/rixxx-panel/components.json"
REPORT_DIR="/root"
TEST_ROOT="${OPENFLUX_TEST_ROOT:-}"

if [[ -n "$TEST_ROOT" ]]; then
  [[ "$TEST_ROOT" == /tmp/* && "$TEST_ROOT" != /tmp/ ]] || {
    echo "[OPENFLUX] ERROR: OPENFLUX_TEST_ROOT must be a dedicated /tmp subdirectory" >&2; exit 1;
  }
  OPENFLUX_BIN="$TEST_ROOT/usr/local/bin/openflux"
  OPENFLUX_DIR="$TEST_ROOT/etc/openflux"
  PROFILE_DIR="$OPENFLUX_DIR/profiles"
  SECRET_DIR="$OPENFLUX_DIR/secrets"
  UNIT="$TEST_ROOT/etc/systemd/system/openflux-exit@.service"
  REGISTRY="$TEST_ROOT/etc/rixxx-panel/components.json"
  REPORT_DIR="$TEST_ROOT/root"
fi

log() { printf '[OPENFLUX] %s\n' "$*"; }
die() { printf '[OPENFLUX] ERROR: %s\n' "$*" >&2; exit 1; }
valid_id() { [[ "${1:-}" =~ ^[a-z][a-z0-9-]{0,31}$ ]]; }
valid_port() { [[ "${1:-}" =~ ^[0-9]+$ ]] && (( $1 >= 1024 && $1 <= 65535 )); }

[[ -n "$TEST_ROOT" || $EUID -eq 0 ]] || die "run as root"
[[ "${1:-}" == --purge && $# -eq 1 ]] || die "explicit --purge is required"
for command in jq systemctl tar; do command -v "$command" >/dev/null 2>&1 || die "missing dependency: $command"; done

mkdir -p "$REPORT_DIR"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
changed=false
backup=""

shopt -s nullglob
profiles=("$PROFILE_DIR"/*.json)
bundles=("$REPORT_DIR"/openflux-*-client)
shopt -u nullglob

if [[ -e "$OPENFLUX_BIN" || -e "$UNIT" || -d "$OPENFLUX_DIR" || ${#bundles[@]} -gt 0 ]]; then
  changed=true
  snapshot="$work/snapshot"
  mkdir -p "$snapshot"
  [[ ! -d "$OPENFLUX_DIR" ]] || cp -a "$OPENFLUX_DIR" "$snapshot/etc-openflux"
  for bundle in "${bundles[@]}"; do
    [[ -d "$bundle" && ! -L "$bundle" ]] || die "unsafe OpenFlux client bundle: $bundle"
    cp -a "$bundle" "$snapshot/$(basename "$bundle")"
  done
  backup="$REPORT_DIR/vertaflux-openflux-uninstall-backup-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
  tar -C "$snapshot" -czf "$backup" .
  chmod 0600 "$backup"
fi

for meta in "${profiles[@]}"; do
  id=$(jq -er '.id' "$meta") || die "invalid profile metadata: $meta"
  port=$(jq -er '.port' "$meta") || die "invalid profile metadata: $meta"
  valid_id "$id" || die "invalid profile id in metadata: $meta"
  valid_port "$port" || die "invalid profile port in metadata: $meta"
  systemctl disable --now "openflux-exit@${id}.service" >/dev/null 2>&1 || true
  if command -v ufw >/dev/null 2>&1; then
    ufw --force delete allow "$port/tcp" comment "VertaFlux OpenFlux $id" >/dev/null 2>&1 ||
      ufw --force delete allow "$port/tcp" comment "RIXXX OpenFlux $id" >/dev/null 2>&1 || true
  fi
done

for bundle in "${bundles[@]}"; do
  find "$bundle" -maxdepth 1 -type f -delete
  rmdir "$bundle" 2>/dev/null || die "client bundle contains unexpected entries: $bundle"
done
rm -f -- "$OPENFLUX_BIN" "$UNIT"
rm -rf -- "$PROFILE_DIR" "$SECRET_DIR" "$OPENFLUX_DIR/backups"
rmdir "$OPENFLUX_DIR" 2>/dev/null || true

if [[ -f "$REGISTRY" ]]; then
  jq '.components.openflux = {installed:false,version:null,path:"/usr/local/bin/openflux",service:"openflux-exit@.service",enabled:false}' \
    "$REGISTRY" > "$REGISTRY.openflux-uninstall-new"
  chmod 0644 "$REGISTRY.openflux-uninstall-new"
  mv "$REGISTRY.openflux-uninstall-new" "$REGISTRY"
fi
systemctl daemon-reload >/dev/null 2>&1 || true
if [[ -z "$TEST_ROOT" ]] && id openflux >/dev/null 2>&1; then
  userdel openflux >/dev/null 2>&1 || log "system user is still busy and was retained"
fi

jq -n --argjson changed "$changed" --arg backup "$backup" \
  '{ok:true,uninstalled:true,changed:$changed,backup:(if $backup == "" then null else $backup end)}'
