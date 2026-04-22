#!/usr/bin/env bash
# claude-console deploy — standart Quickly prosedürü
# Bkz. ContaboSERVER/DEPLOY-PROCEDURE.md
set -euo pipefail

APP=console.quickly.host
PORT=5180
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

rsync_run() {
  if [[ -n "$SSH_PASS" ]] && command -v "$SSHPASS_BIN" >/dev/null 2>&1; then
    rsync -az --delete --exclude-from='.deployignore' \
      -e "$SSHPASS_BIN -p $SSH_PASS ssh $SSH_OPTS" "$@"
  else
    rsync -az --delete --exclude-from='.deployignore' \
      -e "ssh $SSH_OPTS" "$@"
  fi
}

TS=$(date +%Y%m%d-%H%M%S)
REMOTE=/var/www/${APP}/releases/${TS}

cd "$(dirname "$0")/.."

echo "→ [1/8] build"
npm ci
npm run build

echo "→ [2/8] upload ${TS}"
ssh_run "mkdir -p ${REMOTE}"
rsync_run ./ "${SSH_HOST}:${REMOTE}/"

echo "→ [3/8] symlink shared"
ssh_run "cd ${REMOTE} && \
  ln -sfn /var/www/${APP}/shared/.env .env && \
  ln -sfn /var/www/${APP}/shared/data data && \
  ln -sfn /var/www/${APP}/shared/logs logs && \
  ln -sfn /var/www/${APP}/shared/sandbox sandbox"

echo "→ [4/8] npm ci --omit=dev (native derleme)"
ssh_run "cd ${REMOTE} && npm ci --omit=dev"

echo "→ [4b/8] release ownership → claude:claude"
ssh_run "chown -R claude:claude ${REMOTE}"

echo "→ [5/8] atomik switch current → ${TS}"
ssh_run "ln -sfn ${REMOTE} /var/www/${APP}/current"

echo "→ [6/8] servis restart"
ssh_run "systemctl restart ${APP}.service"

echo "→ [7/8] health check"
sleep 3
ssh_run "systemctl is-active ${APP}.service"
ssh_run "curl -sf -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:${PORT}/ || echo 'HTTP check failed (servis henuz hazir olmayabilir)'"

echo "→ [8/8] eski release temizligi (son 5)"
ssh_run "cd /var/www/${APP}/releases && ls -1t | tail -n +6 | xargs -r rm -rf"

echo "✓ ${APP} @ ${TS}"
