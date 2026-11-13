#!/usr/bin/env bash
set -euo pipefail

# Read-only report safe to share with the VertaFlux maintainer. Passwords,
# private keys and raw service configuration are intentionally excluded.
[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
command -v python3 >/dev/null || { echo 'python3 is required.' >&2; exit 1; }

target_mieru=${VERTAFLUX_MIERU_TARGET:-3.38.0}
output=${1:-./vertaflux-inventory-$(date -u +%Y%m%dT%H%M%SZ).txt}
[[ ! -e "$output" ]] || { echo "Refusing to overwrite: $output" >&2; exit 1; }
umask 077
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT

section() { printf '\n## %s\n' "$1" >>"$output"; }
run() {
  printf '\n$ %s\n' "$*" >>"$output"
  "$@" >>"$output" 2>&1 || printf '[command failed: %s]\n' "$?" >>"$output"
}

cat >"$output" <<EOF
VertaFlux legacy Mieru inventory
Generated UTC: $(date -u +%FT%TZ)
Target Mieru: ${target_mieru}
Secrets included: no
EOF

section 'Operating system'
run hostnamectl
run uname -a
run sh -c 'cat /etc/os-release'
run dpkg --print-architecture
run systemd-detect-virt
run df -hT /
run free -h

section 'Mieru binaries'
for binary in mita mieru mieru-client; do
  if path=$(command -v "$binary" 2>/dev/null); then
    printf '%s.path=%s\n' "$binary" "$path" >>"$output"
    run "$binary" version
    run sha256sum "$path"
    run dpkg-query -S "$path"
  else
    printf '%s=not-installed\n' "$binary" >>"$output"
  fi
done

section 'Sanitized active Mita state'
if command -v mita >/dev/null && mita describe config >"$tmp/mita.json" 2>"$tmp/mita.err"; then
  python3 - "$tmp/mita.json" >>"$output" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as stream:
    cfg = json.load(stream)
users = cfg.get("users", [])
bindings = cfg.get("portBindings", [])
print("validJson=true")
print(f"users.count={len(users)}")
print("users.names=" + ",".join(sorted(str(u.get("name", "")) for u in users)))
print("portBindings=" + json.dumps(bindings, ensure_ascii=False, separators=(",", ":")))
print(f"mtu={cfg.get('mtu', 'unset')}")
print(f"loggingLevel={cfg.get('loggingLevel', 'unset')}")
print(f"trafficPattern.present={str('trafficPattern' in cfg).lower()}")
print("userPermissions=" + json.dumps([
    {"name": u.get("name", ""), "allowLoopbackIP": bool(u.get("allowLoopbackIP", False)),
     "allowPrivateIP": bool(u.get("allowPrivateIP", False))}
    for u in users
], ensure_ascii=False, separators=(",", ":")))
PY
else
  printf 'validJson=false\n' >>"$output"
  sed -E 's/(password|token|secret|key)[=:][^ ]+/\1=[REDACTED]/Ig' "$tmp/mita.err" >>"$output"
fi

section 'Relevant services'
run sh -c "systemctl list-unit-files --no-pager | grep -Ei 'mieru|mita|nginx|caddy|gunicorn|panel' || true"
run sh -c "systemctl list-units --type=service --all --no-pager | grep -Ei 'mieru|mita|nginx|caddy|gunicorn|panel' || true"

section 'Listening sockets'
run ss -H -lntup

section 'Firewall summary'
if command -v ufw >/dev/null; then run ufw status verbose; else printf 'ufw=not-installed\n' >>"$output"; fi
if command -v nft >/dev/null; then run sh -c 'nft list ruleset | grep -E "^(table|chain|[[:space:]]+(tcp|udp)[[:space:]]+dport)" || true'; fi

section 'Legacy panel files (metadata only)'
for path in /opt/mieru-panel /etc/mieru /var/lib/mieru /var/lib/mita; do
  if [[ -e "$path" ]]; then run du -sh "$path"; run find "$path" -maxdepth 2 -type f -printf '%m %u:%g %s %p\n';
  else printf '%s=absent\n' "$path" >>"$output"; fi
done

section 'Relevant packages'
run sh -c "dpkg-query -W -f='\${binary:Package}\t\${Version}\n' | grep -Ei 'mieru|nginx|caddy|python3|gunicorn|sqlite' || true"

chmod 600 "$output"
echo "Inventory written to $output"
echo 'This report is sanitized and may be shared for migration planning.'
