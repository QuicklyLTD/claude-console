#!/usr/bin/env bash
# claude-console rollback — standart Quickly prosedürü
# Kullanim: ./scripts/rollback.sh [release-id]
# Parametre verilmezse son 5 release listelenir ve secim istenir.
set -euo pipefail

APP=console.quickly.host
SSH_HOST=${SSH_HOST:-root@95.111.230.121}
SSH_OPTS=${SSH_OPTS:--o StrictHostKeyChecking=no}
SSHPASS_BIN=${SSHPASS_BIN:-sshpass}
SSH_PASS=${SSH_PASS:-}

ssh_run() {
  if [[ -n "$SSH_PASS" ]] && command -v "$SSHPASS_BIN" >/dev/null 2>&1; then
    "$SSHPASS_BIN" -p "$SSH_PASS" ssh $SSH_OPTS "$SSH_HOST" "$@"
  else
    ssh $SSH_OPTS "$SSH_HOST" "$@"
  fi
}

PREV=${1:-}
if [[ -z "$PREV" ]]; then
  echo "Mevcut release'ler:"
  ssh_run "ls -1t /var/www/${APP}/releases/ | head -5"
  echo
  read -r -p "Dönülecek release-id: " PREV
fi

echo "→ current → ${PREV}"
ssh_run "test -d /var/www/${APP}/releases/${PREV}"
ssh_run "ln -sfn /var/www/${APP}/releases/${PREV} /var/www/${APP}/current"
ssh_run "systemctl restart ${APP}.service"
sleep 2
ssh_run "systemctl is-active ${APP}.service"
echo "✓ rollback → ${PREV}"
