#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$ROOT/supply-chain/components.json"
REPORT_DIR="${GO_VULN_AUDIT_DIR:-$ROOT/dist/go-vulnerability-audit}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

command -v jq >/dev/null || { echo 'jq is required' >&2; exit 2; }
command -v govulncheck >/dev/null || { echo 'govulncheck is required' >&2; exit 2; }
mkdir -p "$REPORT_DIR"

components=(
  caddy-forwardproxy-naive
  mita
  mieru-client
  hysteria2
  xray-core
  wgcf
  openflux
)
failed=0

for component in "${components[@]}"; do
  record="$(jq -cer --arg name "$component" '
    .components[] | select(.name == $name) |
    {version, artifact: (.artifacts[] | select(.arch == "linux-amd64"))}
  ' "$MANIFEST")" || { echo "missing linux-amd64 manifest artifact: $component" >&2; exit 2; }
  version="$(jq -r '.version' <<<"$record")"
  url="$(jq -r '.artifact.url' <<<"$record")"
  expected="$(jq -r '.artifact.sha256' <<<"$record")"
  component_dir="$WORK/$component"
  archive="$component_dir/artifact"
  mkdir -p "$component_dir/unpacked"

  echo "Downloading $component $version"
  curl --fail --location --retry 3 --connect-timeout 15 --max-time 180 \
    --output "$archive" "$url"
  printf '%s  %s\n' "$expected" "$archive" | sha256sum --check --status -

  case "$component" in
    caddy-forwardproxy-naive)
      tar -xJf "$archive" -C "$component_dir/unpacked"
      binary="$(find "$component_dir/unpacked" -maxdepth 3 -type f \
        \( -name caddy -o -name caddy-naive -o -name caddy-forwardproxy-naive \) -print -quit)"
      ;;
    mita)
      dpkg-deb -x "$archive" "$component_dir/unpacked"
      binary="$(find "$component_dir/unpacked" -type f -name mita -print -quit)"
      ;;
    mieru-client)
      dpkg-deb -x "$archive" "$component_dir/unpacked"
      binary="$(find "$component_dir/unpacked" -type f -name mieru -print -quit)"
      ;;
    xray-core)
      unzip -q "$archive" -d "$component_dir/unpacked"
      binary="$(find "$component_dir/unpacked" -maxdepth 2 -type f -iname xray -print -quit)"
      ;;
    hysteria2|wgcf|openflux)
      binary="$archive"
      ;;
    *)
      echo "no extraction rule for $component" >&2
      exit 2
      ;;
  esac

  [[ -n "${binary:-}" && -f "$binary" ]] || {
    echo "auditable binary not found for $component" >&2
    exit 2
  }
  chmod 0755 "$binary"
  report="$REPORT_DIR/${component}-${version//\//_}.txt"
  {
    printf 'component: %s\nversion: %s\nartifact_sha256: %s\n\n' \
      "$component" "$version" "$expected"
    go version -m "$binary"
    printf '\n'
  } > "$report"

  echo "Auditing $component $version"
  if govulncheck -mode binary "$binary" >> "$report" 2>&1; then
    tail -n 8 "$report"
  else
    cat "$report" >&2
    failed=1
  fi
done

if (( failed != 0 )); then
  echo 'One or more pinned Go binaries contain a reachable known vulnerability.' >&2
  exit 1
fi
echo 'All pinned linux-amd64 Go binaries passed govulncheck.'
