#!/usr/bin/env bash
set -euo pipefail

# Consistent filesystem/config backup without stopping the legacy panel or Mita.
# The archive contains plaintext VPN credentials and must never be shared openly.
[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
for command in tar python3 sha256sum; do
  command -v "$command" >/dev/null || { echo "$command is required." >&2; exit 1; }
done

archive=${1:-./vertaflux-legacy-backup-$(date -u +%Y%m%dT%H%M%SZ).tar.gz}
[[ "$archive" == *.tar.gz ]] || { echo 'Backup filename must end with .tar.gz.' >&2; exit 1; }
[[ ! -e "$archive" && ! -e "$archive.sha256" ]] || { echo "Refusing to overwrite: $archive" >&2; exit 1; }
umask 077
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
mkdir -p "$stage/files" "$stage/commands" "$stage/systemd"

copy_path() {
  local source=$1 destination="$stage/files$1"
  [[ -e "$source" ]] || return 0
  mkdir -p "$(dirname "$destination")"
  cp -a -- "$source" "$destination"
}

cat >"$stage/README-SECRET.txt" <<'EOF'
CONFIDENTIAL VertaFlux migration backup.
This archive can contain plaintext Mieru passwords, panel databases, firewall
rules and service configuration. Keep it root-only and transfer it encrypted.
EOF
printf 'createdUtc=%s\nhostname=%s\n' "$(date -u +%FT%TZ)" "$(hostname)" >"$stage/manifest.txt"

if command -v mita >/dev/null; then
  mita describe config >"$stage/mita-config.json"
  python3 - "$stage/mita-config.json" >>"$stage/manifest.txt" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as stream:
    cfg = json.load(stream)
users, bindings = cfg.get("users"), cfg.get("portBindings")
if not isinstance(users, list) or not isinstance(bindings, list) or not users:
    raise SystemExit("active Mita config has no usable users/portBindings")
for user in users:
    if not user.get("name") or not user.get("password"):
        raise SystemExit("a Mita user has no name or plaintext password")
print(f"mitaUsers={len(users)}")
print(f"mitaPortBindings={len(bindings)}")
PY
  mita version >"$stage/commands/mita-version.txt" 2>&1 || true
  mita_path=$(command -v mita)
  copy_path "$mita_path"
  sha256sum "$mita_path" >"$stage/commands/mita-binary.sha256"
else
  echo 'mita is not installed; refusing incomplete migration backup.' >&2
  exit 1
fi

for path in \
  /opt/mieru-panel /etc/mieru /var/lib/mieru /var/lib/mita \
  /etc/nginx /etc/caddy /var/lib/caddy; do
  copy_path "$path"
done

while IFS= read -r unit; do
  [[ -n "$unit" ]] || continue
  systemctl cat "$unit" >"$stage/systemd/${unit//\//_}.txt" 2>&1 || true
  fragment=$(systemctl show -p FragmentPath --value "$unit" 2>/dev/null || true)
  [[ -n "$fragment" ]] && copy_path "$fragment"
done < <(systemctl list-unit-files --no-legend --no-pager 2>/dev/null |
  awk 'tolower($1) ~ /(mieru|mita|panel|gunicorn|nginx|caddy)/ {print $1}')

systemctl list-units --type=service --all --no-pager >"$stage/commands/systemd-services.txt" 2>&1 || true
ss -H -lntup >"$stage/commands/listening-sockets.txt" 2>&1 || true
dpkg-query -W >"$stage/commands/packages.txt" 2>&1 || true
if command -v ufw >/dev/null; then ufw status verbose >"$stage/commands/ufw.txt" 2>&1 || true; fi
if command -v nft >/dev/null; then nft list ruleset >"$stage/commands/nftables.txt" 2>&1 || true; fi
if command -v iptables-save >/dev/null; then iptables-save >"$stage/commands/iptables.txt" 2>&1 || true; fi
if command -v ip6tables-save >/dev/null; then ip6tables-save >"$stage/commands/ip6tables.txt" 2>&1 || true; fi

find "$stage" -type f -exec chmod 600 {} +
tar -C "$stage" -czf "$archive" .
chmod 600 "$archive"
sha256sum "$archive" >"$archive.sha256"
chmod 600 "$archive.sha256"

tar -tzf "$archive" >/dev/null
sha256sum -c "$archive.sha256"
echo "Backup created and verified: $archive"
echo "Checksum: $archive.sha256"
echo 'CONFIDENTIAL: do not send this archive in chat; it contains VPN passwords.'
