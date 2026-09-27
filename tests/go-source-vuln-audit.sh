#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$ROOT/supply-chain/components.json"
REPORT_DIR="${GO_VULN_AUDIT_DIR:-$ROOT/dist/go-vulnerability-audit}/source"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

for tool in git jq govulncheck; do
  command -v "$tool" >/dev/null || { echo "$tool is required" >&2; exit 2; }
done
mkdir -p "$REPORT_DIR"
failed=0
declare -A scanned_commits=()

while IFS=$'\t' read -r component source ref commit; do
  [[ "$source" =~ ^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || {
    echo "unsafe source URL for $component" >&2; exit 2;
  }
  [[ "$ref" =~ ^[A-Za-z0-9._/-]+$ && "$commit" =~ ^[a-f0-9]{40}$ ]] || {
    echo "unpinned source revision for $component" >&2; exit 2;
  }
  # Mita and mieru-client intentionally share one source commit; scan it once.
  [[ -z "${scanned_commits[$commit]:-}" ]] || continue
  scanned_commits[$commit]=1

  checkout="$WORK/$component"
  mkdir -p "$checkout"
  git -C "$checkout" init -q
  git -C "$checkout" remote add origin "$source.git"
  git -C "$checkout" fetch -q --depth 1 origin "$commit"
  git -C "$checkout" checkout -q --detach FETCH_HEAD
  [[ "$(git -C "$checkout" rev-parse HEAD)" == "$commit" ]] || {
    echo "source commit mismatch for $component" >&2; exit 2;
  }

  mapfile -d '' modules < <(find "$checkout" -name go.mod -type f \
    -not -path '*/vendor/*' -not -path '*/testdata/*' -print0 | sort -z)
  ((${#modules[@]} > 0)) || { echo "no Go module found for $component@$ref" >&2; exit 2; }

  index=0
  for go_mod in "${modules[@]}"; do
    index=$((index + 1))
    module_dir="$(dirname "$go_mod")"
    module_path="$(awk '$1 == "module" {print $2; exit}' "$go_mod")"
    report="$REPORT_DIR/${component}-${index}.txt"
    {
      printf 'component: %s\nsource_ref: %s\nsource_commit: %s\nmodule: %s\n\n' \
        "$component" "$ref" "$commit" "$module_path"
    } > "$report"
    echo "Source-auditing $component@$ref module $module_path"
    if (cd "$module_dir" && govulncheck ./...) >> "$report" 2>&1; then
      tail -n 8 "$report"
    else
      cat "$report" >&2
      failed=1
    fi
  done
done < <(jq -r '.components[] | [.name, .source, .sourceRef, .sourceCommit] | @tsv' "$MANIFEST")

if (( failed != 0 )); then
  echo 'One or more exact upstream source modules failed source-mode govulncheck.' >&2
  exit 1
fi
echo 'All exact upstream source modules passed source-mode govulncheck.'
