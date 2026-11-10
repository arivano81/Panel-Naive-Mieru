#!/usr/bin/env bash
set -Eeuo pipefail
umask 022

ROOT="${VERTAFLUX_LOGROTATE_ROOT:-}"
if [[ -n "$ROOT" ]]; then
  case "$ROOT" in /tmp/vertaflux-logrotate-test-*) ;; *)
    echo 'VERTAFLUX_LOGROTATE_ROOT must be a dedicated /tmp/vertaflux-logrotate-test-* directory' >&2; exit 1 ;;
  esac
fi
[[ -n "$ROOT" || ${EUID:-$(id -u)} -eq 0 ]] || {
  echo 'run as root: sudo bash install_logrotate.sh' >&2; exit 1;
}

DEST="$ROOT/etc/logrotate.d/vertaflux"
mkdir -p "$(dirname "$DEST")"
TMP="${DEST}.new"
cat > "$TMP" <<'EOF'
/var/log/panel-naive-mieru.log /var/log/vertaflux-install.log /var/log/cascade-watchdog.log {
    daily
    maxsize 10M
    rotate 14
    missingok
    notifempty
    compress
    delaycompress
    copytruncate
    su root root
    create 0640 root root
}
EOF
chmod 0644 "$TMP"
mv -f "$TMP" "$DEST"

if [[ -z "$ROOT" ]]; then
  if ! command -v logrotate >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq logrotate
  fi
  logrotate -d "$DEST" >/dev/null 2>&1
fi
echo "logrotate config installed: ${DEST}"
