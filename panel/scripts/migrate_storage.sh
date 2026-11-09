#!/usr/bin/env bash
set -euo pipefail

ROOT="${VERTAFLUX_TEST_ROOT:-}"

check_dir() {
  local legacy="$ROOT$1" canonical="$ROOT$2" mode="$3"

  if [[ -L "$canonical" || ( -e "$canonical" && ! -d "$canonical" ) ]]; then
    echo "Canonical storage must be a real directory: $canonical" >&2
    return 1
  fi

  if [[ -L "$legacy" ]]; then
    [[ "$(readlink "$legacy")" == "$canonical" ]] || {
      echo "Refusing to replace unexpected symlink: $legacy" >&2
      return 1
    }
  elif [[ -d "$legacy" && -d "$canonical" ]]; then
    echo "Refusing to merge two storage directories: $legacy and $canonical" >&2
    return 1
  elif [[ -e "$legacy" && ! -d "$legacy" ]]; then
    echo "Unsupported storage path: $legacy" >&2
    return 1
  fi
}

migrate_dir() {
  local legacy="$ROOT$1" canonical="$ROOT$2" mode="$3"

  if [[ -L "$legacy" ]]; then
    mkdir -p "$canonical"
  elif [[ -d "$legacy" && ! -e "$canonical" ]]; then
    mv "$legacy" "$canonical"
    ln -s "$canonical" "$legacy"
  elif [[ ! -e "$legacy" ]]; then
    mkdir -p "$canonical"
    ln -s "$canonical" "$legacy"
  fi

  chmod "$mode" "$canonical"
}

check_dir /etc/rixxx-panel /etc/vertaflux 750
check_dir /var/lib/rixxx-panel /var/lib/vertaflux 700
migrate_dir /etc/rixxx-panel /etc/vertaflux 750
migrate_dir /var/lib/rixxx-panel /var/lib/vertaflux 700

echo "VertaFlux storage ready: $ROOT/etc/vertaflux and $ROOT/var/lib/vertaflux"
