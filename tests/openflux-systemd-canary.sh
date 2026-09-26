#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
INSTALLER="$ROOT/panel/scripts/install_openflux.sh"
LIFECYCLE="$ROOT/panel/scripts/openflux_profile.sh"
UNINSTALLER="$ROOT/panel/scripts/uninstall_openflux.sh"
STATE=/root/rixxx-openflux-systemd-canary.json
PROFILE=systemd-canary
CORE_SERVICES=(caddy-naive mita hysteria-server xray panel-naive-mieru)

die() { printf '[OPENFLUX CANARY] ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '[OPENFLUX CANARY] %s\n' "$*"; }
require_root_debian13() {
  [[ $EUID -eq 0 ]] || die 'run as root on a disposable server'
  [[ -r /etc/os-release ]] || die 'cannot identify the operating system'
  # shellcheck disable=SC1091
  . /etc/os-release
  [[ "${ID:-}" == debian && "${VERSION_ID:-}" == 13 ]] || die 'Debian 13 is required'
  for cmd in jq systemctl ss; do command -v "$cmd" >/dev/null || die "missing dependency: $cmd"; done
}
core_state() {
  local service active
  for service in "${CORE_SERVICES[@]}"; do
    active=false
    systemctl is-active --quiet "$service" 2>/dev/null && active=true
    jq -cn --arg key "$service" --argjson value "$active" '{key:$key,value:$value}'
  done | jq -cs 'from_entries'
}
read_state() {
  [[ -f "$STATE" && ! -L "$STATE" ]] || die "missing canary state: $STATE"
  [[ "$(stat -c '%a' "$STATE")" == 600 ]] || die 'canary state permissions are not 600'
  jq -e . "$STATE" >/dev/null || die 'canary state is invalid'
  [[ "$(jq -r .machineId "$STATE")" == "$(cat /etc/machine-id)" ]] || die 'state belongs to another machine'
}
assert_core_unchanged() {
  local expected current
  expected=$(jq -c .coreServices "$STATE")
  current=$(core_state)
  [[ "$current" == "$expected" ]] || die "primary service state changed: expected $expected, got $current"
}

prepare() {
  [[ $# -eq 2 || $# -eq 3 ]] || die 'prepare requires <public-host> [port]'
  local host=$2 port=${3:-18445} boot_id machine_id baseline status committed=0
  [[ "$port" =~ ^[0-9]+$ ]] && (( port >= 1024 && port <= 65535 )) || die 'port must be 1024..65535'
  [[ ! -e "$STATE" ]] || die "remove stale state only after auditing it: $STATE"
  [[ ! -e /usr/local/bin/openflux && ! -e /etc/systemd/system/openflux-exit@.service &&
     ! -d /etc/openflux ]] || die 'existing OpenFlux installation found; use a clean disposable server'
  compgen -G '/root/openflux-*-client' >/dev/null && die 'existing OpenFlux client bundle found'
  ss -H -ltn "sport = :$port" | grep -q . && die "TCP port $port is already in use"
  baseline=$(core_state); boot_id=$(cat /proc/sys/kernel/random/boot_id); machine_id=$(cat /etc/machine-id)
  rollback_prepare() {
    local rc=$?
    trap - EXIT
    if (( rc != 0 && committed == 0 )); then
      bash "$UNINSTALLER" --purge >/dev/null 2>&1 || true
      rm -f "$STATE"
    fi
    exit "$rc"
  }
  trap rollback_prepare EXIT
  bash "$INSTALLER"
  bash "$LIFECYCLE" create "$PROFILE" "$port" "$host" >/dev/null
  bash "$LIFECYCLE" start "$PROFILE" >/dev/null
  status=$(bash "$LIFECYCLE" status "$PROFILE")
  jq -e '.active == true and .enabled == true and .listening == true and .healthy == true' \
    <<<"$status" >/dev/null || die 'profile did not become healthy and reboot-enabled'
  jq -n --arg profile "$PROFILE" --arg host "$host" --argjson port "$port" \
    --arg bootId "$boot_id" --arg machineId "$machine_id" --argjson coreServices "$baseline" \
    '{profile:$profile,host:$host,port:$port,bootId:$bootId,machineId:$machineId,
      coreServices:$coreServices,verifiedAfterReboot:false}' > "${STATE}.new"
  chmod 0600 "${STATE}.new"; mv "${STATE}.new" "$STATE"
  assert_core_unchanged
  committed=1
  log "prepared healthy profile $PROFILE on TCP $port"
  log 'reboot now, then run: sudo bash tests/openflux-systemd-canary.sh verify'
}

verify() {
  [[ $# -eq 1 ]] || die 'verify takes no arguments'
  read_state
  [[ "$(jq -r .bootId "$STATE")" != "$(cat /proc/sys/kernel/random/boot_id)" ]] \
    || die 'the server has not rebooted since prepare'
  local profile status
  profile=$(jq -r .profile "$STATE")
  status=$(bash "$LIFECYCLE" status "$profile")
  jq -e '.active == true and .enabled == true and .listening == true and .healthy == true' \
    <<<"$status" >/dev/null || die 'profile was not restored healthy after reboot'
  assert_core_unchanged
  jq '.verifiedAfterReboot = true' "$STATE" > "${STATE}.new"
  chmod 0600 "${STATE}.new"; mv "${STATE}.new" "$STATE"
  log 'reboot persistence verified; run cleanup to test scoped uninstall'
}

cleanup() {
  [[ $# -eq 1 ]] || die 'cleanup takes no arguments'
  read_state
  jq -e '.verifiedAfterReboot == true' "$STATE" >/dev/null || die 'run verify after reboot before cleanup'
  local profile profiles
  profile=$(jq -r .profile "$STATE"); profiles=$(bash "$LIFECYCLE" list)
  jq -e --arg id "$profile" 'length == 1 and .[0].id == $id' <<<"$profiles" >/dev/null \
    || die 'unexpected OpenFlux profiles found; refusing broad cleanup'
  assert_core_unchanged
  bash "$UNINSTALLER" --purge
  [[ ! -e /usr/local/bin/openflux && ! -e /etc/systemd/system/openflux-exit@.service &&
     ! -d /etc/openflux ]] || die 'OpenFlux artifacts remain after uninstall'
  assert_core_unchanged
  rm -f "$STATE"
  log 'systemd, reboot and scoped uninstall canary passed'
}

require_root_debian13
case "${1:-}" in
  prepare) prepare "$@" ;;
  verify) verify "$@" ;;
  cleanup) cleanup "$@" ;;
  *) die 'usage: openflux-systemd-canary.sh prepare <public-host> [port] | verify | cleanup' ;;
esac
