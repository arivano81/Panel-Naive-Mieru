#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
CASCADE="$ROOT/panel/scripts/cascade_mieru.sh"
STATE=/root/rixxx-cascade-systemd-canary.json
CLIENT_CONFIG=/root/rixxx-cascade-canary-client.json
CLIENT_UNIT=/etc/systemd/system/rixxx-cascade-canary-client.service
CLIENT_SERVICE=rixxx-cascade-canary-client
CLIENT_PORT=19090
CORE_SERVICES=(caddy-naive mita hysteria-server xray pm2-root)
PREPARE_COMMITTED=0

die() { printf '[CASCADE CANARY] ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '[CASCADE CANARY] %s\n' "$*"; }

require_root_debian13() {
  [[ $EUID -eq 0 ]] || die 'run as root on the disposable Entry node'
  [[ -r /etc/os-release ]] || die 'cannot identify the operating system'
  # shellcheck disable=SC1091
  . /etc/os-release
  [[ "${ID:-}" == debian && "${VERSION_ID:-}" == 13 ]] || die 'Debian 13 is required'
  for cmd in jq systemctl iptables curl ss stat; do
    command -v "$cmd" >/dev/null || die "missing dependency: $cmd"
  done
  [[ -x /usr/local/bin/xray ]] || die 'Xray must already be installed on Entry'
  [[ -x "$CASCADE" ]] || die "missing cascade orchestrator: $CASCADE"
}

core_state() {
  local service active enabled
  for service in "${CORE_SERVICES[@]}"; do
    active=false; enabled=false
    systemctl is-active --quiet "$service" 2>/dev/null && active=true
    systemctl is-enabled --quiet "$service" 2>/dev/null && enabled=true
    jq -cn --arg key "$service" --argjson active "$active" --argjson enabled "$enabled" \
      '{key:$key,value:{active:$active,enabled:$enabled}}'
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

remove_client_probe() {
  systemctl disable --now "$CLIENT_SERVICE" >/dev/null 2>&1 || true
  rm -f "$CLIENT_UNIT"
  [[ -f "$CLIENT_CONFIG" ]] && { shred -u "$CLIENT_CONFIG" 2>/dev/null || rm -f "$CLIENT_CONFIG"; }
  systemctl daemon-reload >/dev/null 2>&1 || true
}

validate_client_config() {
  local source=$1
  [[ -f "$source" && ! -L "$source" ]] || die 'client config must be a regular non-symlink file'
  [[ "$(stat -c '%a' "$source")" == 600 ]] || die 'client config permissions must be 600'
  jq -e --argjson port "$CLIENT_PORT" '
    any(.inbounds[]?; .protocol == "socks" and (.listen == "127.0.0.1" or .listen == "localhost") and .port == $port)
    and any(.outbounds[]?; .protocol == "vless")
  ' "$source" >/dev/null || die "client config needs a loopback SOCKS inbound on $CLIENT_PORT and a VLESS outbound"
  /usr/local/bin/xray run -test -format json -config "$source" >/dev/null 2>&1 \
    || die 'Xray rejected the supplied VLESS client config'
}

write_client_unit() {
  cat > "$CLIENT_UNIT" <<EOF
[Unit]
Description=RIXXX cascade reboot canary VLESS client
After=network-online.target xray.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/xray run -format json -config $CLIENT_CONFIG
Restart=on-failure
RestartSec=2s
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadOnlyPaths=$CLIENT_CONFIG

[Install]
WantedBy=multi-user.target
EOF
  chmod 0644 "$CLIENT_UNIT"
  systemctl daemon-reload
  systemctl enable --now "$CLIENT_SERVICE"
}

assert_cascade_health() {
  local expected_exit=$1 xuid
  systemctl is-active --quiet mieru || die 'mieru client service is not active'
  systemctl is-enabled --quiet mieru || die 'mieru client service is not enabled'
  systemctl is-active --quiet redsocks || die 'redsocks service is not active'
  systemctl is-enabled --quiet redsocks || die 'redsocks service is not enabled'
  systemctl is-active --quiet "$CLIENT_SERVICE" || die 'VLESS canary client is not active'
  systemctl is-enabled --quiet "$CLIENT_SERVICE" || die 'VLESS canary client is not enabled'
  ss -H -ltn "sport = :$CLIENT_PORT" | grep -q . || die "SOCKS probe port $CLIENT_PORT is not listening"
  xuid=$(id -u xray)
  iptables -t nat -C OUTPUT -p tcp -m owner --uid-owner "$xuid" -j REDSOCKS 2>/dev/null \
    || die 'Xray owner rule is missing from the REDSOCKS chain'
  iptables -t nat -C REDSOCKS -d "${expected_exit}/32" -j RETURN 2>/dev/null \
    || die 'Exit anti-loop rule is missing'
}

probe_vless_cascade() {
  local expected=$1 actual
  actual=$(curl --silent --show-error --fail --max-time 20 \
    --socks5-hostname "127.0.0.1:$CLIENT_PORT" https://api.ipify.org | tr -d '[:space:]')
  [[ "$actual" == "$expected" ]] || die "unexpected VLESS cascade egress: expected $expected, got ${actual:-empty}"
}

prepare() {
  [[ $# -eq 7 ]] || die 'prepare requires <exit-host> <port-start> <port-end> <exit-user> <expected-exit-ip> <vless-client-config>'
  local exit_host=$2 port_start=$3 port_end=$4 exit_user=$5 expected_exit=$6 source_config=$7
  local exit_pass baseline boot_id machine_id
  [[ "$port_start" =~ ^[0-9]+$ && "$port_end" =~ ^[0-9]+$ ]] || die 'Exit ports must be numeric'
  (( port_start >= 1024 && port_start <= port_end && port_end <= 65535 )) || die 'invalid Exit port range'
  [[ "$expected_exit" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die 'expected Exit egress must be an IPv4 literal'
  [[ ! -e "$STATE" && ! -e "$CLIENT_UNIT" && ! -e "$CLIENT_CONFIG" ]] || die 'existing canary state found; audit it before cleanup'
  [[ ! -e /etc/systemd/system/mieru.service && ! -e /var/lib/vertaflux/cascade-mieru.state ]] \
    || die 'Entry already has cascade state; use a disposable non-cascade baseline'
  ! iptables -t nat -S REDSOCKS >/dev/null 2>&1 || die 'existing REDSOCKS chain found'
  IFS= read -r exit_pass || [[ -n "$exit_pass" ]] || die 'read the Exit password from stdin'
  [[ -n "$exit_pass" ]] || die 'Exit password must not be empty'
  validate_client_config "$source_config"
  baseline=$(core_state); boot_id=$(cat /proc/sys/kernel/random/boot_id); machine_id=$(cat /etc/machine-id)
  rollback_prepare() {
    local rc=$?
    trap - EXIT
    if (( rc != 0 && PREPARE_COMMITTED == 0 )); then
      remove_client_probe
      bash "$CASCADE" teardown >/dev/null 2>&1 || true
      rm -f "$STATE"
    fi
    exit "$rc"
  }
  trap rollback_prepare EXIT
  install -o root -g root -m 0600 "$source_config" "$CLIENT_CONFIG"
  printf '%s\n' "$exit_pass" | bash "$CASCADE" setup --exit-pass-stdin \
    --exit-host "$exit_host" --exit-port-start "$port_start" --exit-port-end "$port_end" --exit-user "$exit_user"
  unset exit_pass
  write_client_unit
  assert_cascade_health "$expected_exit"
  probe_vless_cascade "$expected_exit"
  jq -n --arg bootId "$boot_id" --arg machineId "$machine_id" --arg expectedExit "$expected_exit" \
    --argjson coreServices "$baseline" \
    '{bootId:$bootId,machineId:$machineId,expectedExit:$expectedExit,coreServices:$coreServices,verifiedAfterReboot:false}' \
    > "${STATE}.new"
  chmod 0600 "${STATE}.new"; mv "${STATE}.new" "$STATE"
  assert_core_unchanged
  PREPARE_COMMITTED=1
  log 'real VLESS traffic reached the expected Exit through the cascade'
  log 'reboot Entry now, then run: sudo bash tests/cascade-systemd-canary.sh verify'
}

verify() {
  [[ $# -eq 1 ]] || die 'verify takes no arguments'
  read_state
  [[ "$(jq -r .bootId "$STATE")" != "$(cat /proc/sys/kernel/random/boot_id)" ]] \
    || die 'Entry has not rebooted since prepare'
  local expected_exit
  expected_exit=$(jq -r .expectedExit "$STATE")
  assert_cascade_health "$expected_exit"
  probe_vless_cascade "$expected_exit"
  assert_core_unchanged
  jq '.verifiedAfterReboot = true' "$STATE" > "${STATE}.new"
  chmod 0600 "${STATE}.new"; mv "${STATE}.new" "$STATE"
  log 'cascade and real VLESS egress recovered after reboot; run cleanup'
}

cleanup() {
  [[ $# -eq 1 ]] || die 'cleanup takes no arguments'
  read_state
  jq -e '.verifiedAfterReboot == true' "$STATE" >/dev/null || die 'run verify after reboot before cleanup'
  assert_core_unchanged
  remove_client_probe
  bash "$CASCADE" teardown
  ! iptables -t nat -S REDSOCKS >/dev/null 2>&1 || die 'REDSOCKS chain remains after teardown'
  [[ ! -e "$CLIENT_UNIT" && ! -e "$CLIENT_CONFIG" ]] || die 'canary client artifacts remain after cleanup'
  assert_core_unchanged
  rm -f "$STATE"
  log 'two-node cascade reboot canary and scoped cleanup passed'
}

require_root_debian13
case "${1:-}" in
  prepare) prepare "$@" ;;
  verify) verify "$@" ;;
  cleanup) cleanup "$@" ;;
  *) die 'usage: cascade-systemd-canary.sh prepare <exit-host> <port-start> <port-end> <exit-user> <expected-exit-ip> <vless-client-config> | verify | cleanup' ;;
esac
