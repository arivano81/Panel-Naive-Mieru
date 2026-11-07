#!/usr/bin/env bash
set -euo pipefail

OPENFLUX_BIN="/usr/local/bin/openflux"
OPENFLUX_DIR="/etc/openflux"
PROFILE_DIR="$OPENFLUX_DIR/profiles"
SECRET_DIR="$OPENFLUX_DIR/secrets"
UNIT="/etc/systemd/system/openflux-exit@.service"
LOCK="/run/lock/rixxx-openflux-profile.lock"
REPORT_DIR="/root"
TEST_ROOT="${OPENFLUX_TEST_ROOT:-}"

if [[ -n "$TEST_ROOT" ]]; then
  [[ "$TEST_ROOT" == /tmp/* && "$TEST_ROOT" != "/tmp/" ]] || {
    echo "[OPENFLUX] ERROR: OPENFLUX_TEST_ROOT must be a dedicated /tmp subdirectory" >&2; exit 1;
  }
  OPENFLUX_BIN="$TEST_ROOT/usr/local/bin/openflux"
  OPENFLUX_DIR="$TEST_ROOT/etc/openflux"
  PROFILE_DIR="$OPENFLUX_DIR/profiles"
  SECRET_DIR="$OPENFLUX_DIR/secrets"
  UNIT="$TEST_ROOT/etc/systemd/system/openflux-exit@.service"
  LOCK="$TEST_ROOT/run/lock/rixxx-openflux-profile.lock"
  REPORT_DIR="$TEST_ROOT/root"
fi

log() { printf '[OPENFLUX] %s\n' "$*"; }
die() { printf '[OPENFLUX] ERROR: %s\n' "$*" >&2; exit 1; }
valid_id() { [[ "${1:-}" =~ ^[a-z][a-z0-9-]{0,31}$ ]]; }
valid_port() { [[ "${1:-}" =~ ^[0-9]+$ ]] && (( $1 >= 1024 && $1 <= 65535 )); }
service_name() { printf 'openflux-exit@%s.service' "$1"; }
profile_config() { printf '%s/%s.conf' "$PROFILE_DIR" "$1"; }
profile_meta() { printf '%s/%s.json' "$PROFILE_DIR" "$1"; }
profile_secret() { printf '%s/%s.key' "$SECRET_DIR" "$1"; }
firewall_comment() { printf 'VertaFlux OpenFlux %s' "$1"; }

[[ -n "$TEST_ROOT" || $EUID -eq 0 ]] || die "run as root"
for command in node jq openssl systemctl flock ss install cmp timeout; do
  command -v "$command" >/dev/null 2>&1 || die "missing dependency: $command"
done
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ADAPTER="$SCRIPT_DIR/../server/openfluxAdapter.js"
[[ -f "$ADAPTER" ]] || die "missing OpenFlux adapter: $ADAPTER"
mkdir -p "$(dirname "$LOCK")"
exec 9>"$LOCK"
flock -n 9 || die "another OpenFlux profile operation is running"

svcctl() {
  local limit=25s
  [[ -z "$TEST_ROOT" ]] || limit=1s
  timeout --signal=TERM --kill-after=5s "$limit" systemctl "$@"
}

require_installation() {
  [[ -x "$OPENFLUX_BIN" ]] || die "OpenFlux is not installed"
  [[ -f "$UNIT" ]] || die "OpenFlux systemd unit is not installed"
  [[ -n "$TEST_ROOT" ]] || id openflux >/dev/null 2>&1 || die "OpenFlux system user is missing"
}

require_profile() {
  local id=$1
  [[ -f "$(profile_config "$id")" && -f "$(profile_meta "$id")" && -f "$(profile_secret "$id")" ]] \
    || die "profile '$id' does not exist or is incomplete"
}

validate_profile_config() {
  local id=$1 meta config secret expected host port
  meta=$(profile_meta "$id"); config=$(profile_config "$id"); secret=$(profile_secret "$id")
  [[ -s "$secret" ]] || die "profile '$id' has an empty key"
  host=$(jq -er '.host' "$meta") || die "profile '$id' metadata is invalid"
  port=$(jq -er '.port' "$meta") || die "profile '$id' metadata is invalid"
  expected=$(mktemp)
  if ! OPENFLUX_ADAPTER="$ADAPTER" OPENFLUX_ID="$id" OPENFLUX_PORT="$port" OPENFLUX_HOST="$host" \
    node <<'NODE' > "$expected"
const { buildOpenFluxExitConfig } = require(process.env.OPENFLUX_ADAPTER);
process.stdout.write(buildOpenFluxExitConfig({ id: process.env.OPENFLUX_ID,
  port: Number(process.env.OPENFLUX_PORT), host: process.env.OPENFLUX_HOST }));
NODE
  then rm -f "$expected"; die "profile '$id' metadata failed validation"; fi
  cmp -s "$expected" "$config" || { rm -f "$expected"; die "profile '$id' config differs from validated metadata"; }
  rm -f "$expected"
}

firewall_add() {
  local id=$1 port=$2 comment
  comment=$(firewall_comment "$id")
  command -v ufw >/dev/null 2>&1 || { log "UFW is unavailable; no firewall rule was changed"; return 0; }
  ufw allow "$port/tcp" comment "$comment" >/dev/null
}

firewall_remove() {
  local id=$1 port=$2 comment
  comment=$(firewall_comment "$id")
  command -v ufw >/dev/null 2>&1 || return 0
  ufw --force delete allow "$port/tcp" comment "$comment" >/dev/null 2>&1 || true
}

port_is_busy() {
  ss -H -ltn "sport = :$1" 2>/dev/null | grep -q .
}

wait_for_port() {
  local port=$1 attempt attempts=20
  [[ -z "$TEST_ROOT" ]] || attempts=2
  for (( attempt=1; attempt<=attempts; attempt++ )); do
    port_is_busy "$port" && return 0
    sleep 0.25
  done
  return 1
}

create_profile() (
  local id=$1 port=$2 host=$3 config meta secret service work bundle existing committed=0
  valid_id "$id" || die "invalid profile id"
  valid_port "$port" || die "port must be 1024..65535"
  require_installation
  config=$(profile_config "$id"); meta=$(profile_meta "$id"); secret=$(profile_secret "$id")
  service=$(service_name "$id")
  bundle="$REPORT_DIR/openflux-${id}-client"
  [[ ! -e "$config" && ! -e "$meta" && ! -e "$secret" ]] || die "profile '$id' already exists"
  [[ ! -e "$bundle" ]] || die "client bundle already exists: $bundle"
  port_is_busy "$port" && die "TCP port $port is already in use"
  shopt -s nullglob
  for existing in "$PROFILE_DIR"/*.json; do
    jq -e --argjson port "$port" 'select(.port == $port)' "$existing" >/dev/null 2>&1 \
      && die "TCP port $port is already assigned to another OpenFlux profile"
  done
  shopt -u nullglob

  work=$(mktemp -d)
  trap 'status=$?; trap - EXIT; rm -rf "${work:-}"; if (( status != 0 || committed == 0 )); then rm -f -- "${config}.new" "${meta}.new" "${secret}.new" "$config" "$meta" "$secret"; if [[ -d "$bundle" ]]; then find "$bundle" -maxdepth 1 -type f -delete; rmdir "$bundle" 2>/dev/null || true; fi; fi; exit "$status"' EXIT
  openssl rand -base64 48 > "$work/profile.key"
  chmod 0600 "$work/profile.key"
  OPENFLUX_ADAPTER="$ADAPTER" OPENFLUX_ID="$id" OPENFLUX_PORT="$port" \
    OPENFLUX_HOST="$host" OPENFLUX_OUT="$work" node <<'NODE'
const fs = require('fs');
const { buildOpenFluxExitConfig, buildOpenFluxClientConfig } = require(process.env.OPENFLUX_ADAPTER);
const profile = { id: process.env.OPENFLUX_ID, port: Number(process.env.OPENFLUX_PORT), host: process.env.OPENFLUX_HOST };
fs.writeFileSync(`${process.env.OPENFLUX_OUT}/profile.conf`, buildOpenFluxExitConfig(profile));
fs.writeFileSync(`${process.env.OPENFLUX_OUT}/client.conf`, buildOpenFluxClientConfig(profile));
NODE
  jq -n --arg id "$id" --arg host "$host" --argjson port "$port" \
    --arg created "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{schema:1,id:$id,port:$port,host:$host,transport:"direct",mode:"l4",createdAt:$created}' \
    > "$work/profile.json"

  if [[ -n "$TEST_ROOT" ]]; then
    install -m 0600 "$work/profile.key" "${secret}.new"
    install -m 0640 "$work/profile.conf" "${config}.new"
    install -m 0640 "$work/profile.json" "${meta}.new"
  else
    install -o openflux -g openflux -m 0600 "$work/profile.key" "${secret}.new"
    install -o root -g openflux -m 0640 "$work/profile.conf" "${config}.new"
    install -o root -g openflux -m 0640 "$work/profile.json" "${meta}.new"
  fi
  mv "${secret}.new" "$secret"
  mv "${config}.new" "$config"
  mv "${meta}.new" "$meta"

  if [[ -n "$TEST_ROOT" ]]; then
    install -d -m 0700 "$bundle"
    install -m 0600 "$work/profile.key" "$bundle/openflux.key"
    install -m 0600 "$work/client.conf" "$bundle/client.conf"
  else
    install -d -o root -g root -m 0700 "$bundle"
    install -o root -g root -m 0600 "$work/profile.key" "$bundle/openflux.key"
    install -o root -g root -m 0600 "$work/client.conf" "$bundle/client.conf"
  fi
  committed=1
  jq -n --arg id "$id" --argjson port "$port" --arg host "$host" --arg service "$service" \
    --arg bundle "$bundle" \
    '{created:true,id:$id,port:$port,host:$host,service:$service,active:false,clientBundle:$bundle}'
)

start_profile() {
  local id=$1 meta port service
  valid_id "$id" || die "invalid profile id"
  require_installation; require_profile "$id"
  meta=$(profile_meta "$id"); port=$(jq -er '.port' "$meta"); valid_port "$port" || die "invalid stored port"
  service=$(service_name "$id")
  validate_profile_config "$id"
  if svcctl is-active --quiet "$service"; then
    jq -n --arg id "$id" --arg service "$service" --argjson port "$port" \
      '{id:$id,service:$service,port:$port,active:true,changed:false}'
    return
  fi
  port_is_busy "$port" && die "TCP port $port is already in use"
  firewall_add "$id" "$port"
  if ! svcctl enable --now "$service" >/dev/null 2>&1 ||
     ! svcctl is-active --quiet "$service" || ! wait_for_port "$port"; then
    svcctl disable --now "$service" >/dev/null 2>&1 || true
    firewall_remove "$id" "$port"
    die "profile failed its systemd health check; activation rolled back"
  fi
  jq -n --arg id "$id" --arg service "$service" --argjson port "$port" \
    '{id:$id,service:$service,port:$port,active:true,changed:true}'
}

stop_profile() {
  local id=$1 meta port service was_active=false
  valid_id "$id" || die "invalid profile id"
  require_installation; require_profile "$id"
  meta=$(profile_meta "$id"); port=$(jq -er '.port' "$meta"); service=$(service_name "$id")
  svcctl is-active --quiet "$service" && was_active=true
  svcctl disable --now "$service" >/dev/null 2>&1 || true
  firewall_remove "$id" "$port"
  jq -n --arg id "$id" --arg service "$service" --argjson port "$port" --argjson changed "$was_active" \
    '{id:$id,service:$service,port:$port,active:false,changed:$changed}'
}

restart_profile() {
  local id=$1 service meta port
  valid_id "$id" || die "invalid profile id"
  require_installation; require_profile "$id"; validate_profile_config "$id"; service=$(service_name "$id")
  meta=$(profile_meta "$id"); port=$(jq -er '.port' "$meta"); valid_port "$port" || die "invalid stored port"
  svcctl is-active --quiet "$service" || die "profile is not active"
  svcctl restart "$service"
  svcctl is-active --quiet "$service" && wait_for_port "$port" || die "profile failed after restart"
  jq -n --arg id "$id" --arg service "$service" '{id:$id,service:$service,active:true,restarted:true}'
}

reset_profile() {
  local id=$1 meta port service
  valid_id "$id" || die "invalid profile id"
  require_installation; require_profile "$id"; validate_profile_config "$id"
  meta=$(profile_meta "$id"); port=$(jq -er '.port' "$meta"); valid_port "$port" || die "invalid stored port"
  service=$(service_name "$id")
  svcctl disable --now "$service" >/dev/null 2>&1 || true
  firewall_remove "$id" "$port"
  svcctl reset-failed "$service" >/dev/null 2>&1 || true
  port_is_busy "$port" && die "TCP port $port is still in use after stopping the profile"
  firewall_add "$id" "$port"
  if ! svcctl enable --now "$service" >/dev/null 2>&1 ||
     ! svcctl is-active --quiet "$service" || ! wait_for_port "$port"; then
    svcctl disable --now "$service" >/dev/null 2>&1 || true
    firewall_remove "$id" "$port"
    die "profile reset failed its listener health check; activation rolled back"
  fi
  jq -n --arg id "$id" --arg service "$service" --argjson port "$port" \
    '{id:$id,service:$service,port:$port,active:true,listening:true,reset:true}'
}

status_profile() {
  local id=$1 meta service port active=false enabled=false listening=false healthy=false
  valid_id "$id" || die "invalid profile id"
  require_profile "$id"; meta=$(profile_meta "$id"); service=$(service_name "$id")
  port=$(jq -er '.port' "$meta"); valid_port "$port" || die "invalid stored port"
  svcctl is-active --quiet "$service" && active=true
  svcctl is-enabled --quiet "$service" && enabled=true
  port_is_busy "$port" && listening=true
  [[ "$active" == true && "$listening" == true ]] && healthy=true
  jq --arg service "$service" --argjson active "$active" --argjson enabled "$enabled" \
    --argjson listening "$listening" --argjson healthy "$healthy" \
    '. + {service:$service,active:$active,enabled:$enabled,listening:$listening,healthy:$healthy}' "$meta"
}

list_profiles() {
  local meta id
  local -a profiles=()
  shopt -s nullglob
  profiles=("$PROFILE_DIR"/*.json)
  shopt -u nullglob
  if (( ${#profiles[@]} == 0 )); then
    printf '[]\n'
    return
  fi
  for meta in "${profiles[@]}"; do
    id=$(jq -er '.id' "$meta")
    valid_id "$id" || die "invalid profile metadata: $meta"
    status_profile "$id"
  done | jq -s 'sort_by(.id)'
}

rotate_profile() (
  local id=$1 secret bundle service work active=false applied=0 committed=0
  valid_id "$id" || die "invalid profile id"
  require_installation; require_profile "$id"
  secret=$(profile_secret "$id"); bundle="$REPORT_DIR/openflux-${id}-client"
  service=$(service_name "$id")
  [[ -f "$bundle/openflux.key" ]] || die "client bundle is incomplete"
  svcctl is-active --quiet "$service" && active=true
  work=$(mktemp -d)
  cp -- "$secret" "$work/old-server.key"
  cp -- "$bundle/openflux.key" "$work/old-client.key"
  restore_old_keys() {
    if [[ -n "$TEST_ROOT" ]]; then
      install -m 0600 "$work/old-server.key" "$secret"
      install -m 0600 "$work/old-client.key" "$bundle/openflux.key"
    else
      install -o openflux -g openflux -m 0600 "$work/old-server.key" "$secret"
      install -o root -g root -m 0600 "$work/old-client.key" "$bundle/openflux.key"
    fi
  }
  trap 'status=$?; trap - EXIT; if (( status != 0 || committed == 0 )); then if (( applied == 1 )); then restore_old_keys; [[ "$active" == true ]] && svcctl restart "$service" >/dev/null 2>&1 || true; fi; fi; rm -rf "$work"; exit "$status"' EXIT
  openssl rand -base64 48 > "$work/new.key"
  chmod 0600 "$work/new.key"
  if [[ -n "$TEST_ROOT" ]]; then
    install -m 0600 "$work/new.key" "${secret}.new"
    install -m 0600 "$work/new.key" "$bundle/openflux.key.new"
  else
    install -o openflux -g openflux -m 0600 "$work/new.key" "${secret}.new"
    install -o root -g root -m 0600 "$work/new.key" "$bundle/openflux.key.new"
  fi
  applied=1
  mv "${secret}.new" "$secret"
  mv "$bundle/openflux.key.new" "$bundle/openflux.key"
  if [[ "$active" == true ]]; then
    svcctl restart "$service"
    svcctl is-active --quiet "$service" || die "profile failed after key rotation"
  fi
  committed=1
  jq -n --arg id "$id" --arg service "$service" --argjson active "$active" \
    '{rotated:true,id:$id,service:$service,active:$active,oldClientRevoked:true}'
)

remove_profile() {
  local id=$1 meta port bundle
  valid_id "$id" || die "invalid profile id"
  require_installation; require_profile "$id"
  meta=$(profile_meta "$id"); port=$(jq -er '.port' "$meta")
  svcctl disable --now "$(service_name "$id")" >/dev/null 2>&1 || true
  firewall_remove "$id" "$port"
  rm -f -- "$(profile_config "$id")" "$meta" "$(profile_secret "$id")"
  bundle="$REPORT_DIR/openflux-${id}-client"
  if [[ -d "$bundle" ]]; then
    find "$bundle" -maxdepth 1 -type f -delete
    rmdir "$bundle"
  fi
  jq -n --arg id "$id" --arg bundle "$bundle" \
    '{removed:true,id:$id,secretRemoved:true,clientBundleRemoved:$bundle}'
}

usage() {
  echo "Usage: $0 list | create <id> <port> <public-host> | start|stop|restart|reset|rotate|status|remove <id>" >&2
  exit 2
}

ACTION=${1:-}; ID=${2:-}
case "$ACTION" in
  list)   [[ $# -eq 1 ]] || usage; list_profiles ;;
  create) [[ $# -eq 4 ]] || usage; create_profile "$ID" "${3:-}" "${4:-}" ;;
  start)   [[ $# -eq 2 ]] || usage; start_profile "$ID" ;;
  stop)    [[ $# -eq 2 ]] || usage; stop_profile "$ID" ;;
  restart) [[ $# -eq 2 ]] || usage; restart_profile "$ID" ;;
  reset)   [[ $# -eq 2 ]] || usage; reset_profile "$ID" ;;
  rotate)  [[ $# -eq 2 ]] || usage; rotate_profile "$ID" ;;
  status)  [[ $# -eq 2 ]] || usage; status_profile "$ID" ;;
  remove)  [[ $# -eq 2 ]] || usage; remove_profile "$ID" ;;
  *) usage ;;
esac
