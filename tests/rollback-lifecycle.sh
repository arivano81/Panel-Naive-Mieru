#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
VERTAFLUX_UPDATE_LIBRARY_ONLY=1 source "$REPO_ROOT/update.sh"
trap - ERR

TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT
BACKUP_DIR="$TEST_ROOT/backups"
PANEL_CONFIG="$TEST_ROOT/live-config.json"
DB_PATH="$TEST_ROOT/live.sqlite"
CADDY_FILE="$TEST_ROOT/live-Caddyfile"
MITA_STATE_FILE="$TEST_ROOT/live-mita.json"
CADDY_BIN=true
mkdir -p "$BACKUP_DIR"

make_snapshot() {
  local id="$1" dir="$BACKUP_DIR/$1"
  mkdir -p "$dir"
  printf '{"domain":"vpn.example.test"}\n' > "$dir/config.json"
  sqlite3 "$dir/db.sqlite" 'CREATE TABLE users(id INTEGER PRIMARY KEY);'
  printf ':443 { respond "ok" }\n' > "$dir/Caddyfile"
  printf '{"users":[]}\n' > "$dir/mita-state.json"
}

make_snapshot 2026-09-26-010101
make_snapshot 2026-09-26-020202

latest=$(resolve_rollback_backup latest)
[[ "$latest" == "$BACKUP_DIR/2026-09-26-020202" ]]
validate_rollback_backup "$latest"

printf '{broken\n' > "$BACKUP_DIR/2026-09-26-020202/config.json"
if validate_rollback_backup "$BACKUP_DIR/2026-09-26-020202" >/dev/null 2>&1; then
  echo "invalid config snapshot was accepted" >&2
  exit 1
fi

valid="$BACKUP_DIR/2026-09-26-010101"
printf 'unsafe\n' > "$TEST_ROOT/safe"
tar -czf "$valid/panel-files.tar.gz" --transform='s|safe|../escape|' -C "$TEST_ROOT" safe
if validate_rollback_backup "$valid" >/dev/null 2>&1; then
  echo "path-traversal archive was accepted" >&2
  exit 1
fi
rm "$valid/panel-files.tar.gz"
validate_rollback_backup "$valid"

before=$(sha256sum "$valid/config.json" "$valid/db.sqlite")
YES=true DRY_RUN=true ROLLBACK_TARGET=2026-09-26-010101 do_rollback >/dev/null
after=$(sha256sum "$valid/config.json" "$valid/db.sqlite")
[[ "$before" == "$after" ]]

echo "rollback lifecycle: passed"
