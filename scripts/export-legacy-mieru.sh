#!/usr/bin/env bash
set -euo pipefail

# Read-only export from the legacy Mieru panel. It does not stop or reload mita.
[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
command -v mita >/dev/null || { echo 'mita is not installed or not in PATH.' >&2; exit 1; }
command -v python3 >/dev/null || { echo 'python3 is required.' >&2; exit 1; }

output=${1:-./vertaflux-mieru-export.json}
[[ ! -e "$output" ]] || { echo "Refusing to overwrite: $output" >&2; exit 1; }
umask 077
raw=$(mktemp)
trap 'rm -f "$raw"' EXIT
mita describe config >"$raw"

python3 - "$raw" "$output" <<'PY'
import datetime, json, os, socket, sys

source, target = sys.argv[1:]
with open(source, encoding="utf-8") as stream:
    config = json.load(stream)

users = config.get("users")
bindings = config.get("portBindings")
if not isinstance(users, list) or not isinstance(bindings, list):
    raise SystemExit("mita config must contain users[] and portBindings[]")
if not users:
    raise SystemExit("mita config contains no users; export aborted")

seen = set()
for user in users:
    name, password = user.get("name"), user.get("password")
    if not isinstance(name, str) or not name or not isinstance(password, str) or not password:
        raise SystemExit("each Mieru user must have a non-empty name and password")
    if name in seen:
        raise SystemExit(f"duplicate Mieru username: {name}")
    seen.add(name)

for binding in bindings:
    if binding.get("protocol") not in ("TCP", "UDP"):
        raise SystemExit("port binding protocol must be TCP or UDP")
    if not isinstance(binding.get("port"), int) and not isinstance(binding.get("portRange"), str):
        raise SystemExit("each port binding needs port or portRange")

payload = {
    "format": "vertaflux-legacy-mieru",
    "schema": 1,
    "exportedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "sourceHost": socket.gethostname(),
    "mitaConfig": config,
}
with open(target, "x", encoding="utf-8") as stream:
    json.dump(payload, stream, ensure_ascii=False, indent=2)
    stream.write("\n")
os.chmod(target, 0o600)
print(f"Exported {len(users)} users and {len(bindings)} port bindings to {target}")
print("WARNING: the file contains plaintext VPN passwords; keep it root-only.")
PY
