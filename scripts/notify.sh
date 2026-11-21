#!/bin/bash
# Opt-in pushes: POST /api/notify {"job":"<remind|weekly>"} (components/notify.js).
# Usage: notify.sh remind | notify.sh weekly. Cron on the server:
#   0 14 * * * /home/opc/repos/linebot-backend/scripts/notify.sh remind   (21:00 Thai time)
#   0 2 * * 1 /home/opc/repos/linebot-backend/scripts/notify.sh weekly    (Mon 09:00 Thai time)
# Logs only time, HTTP status and the counts the API returns.
# Env file must define API_URL (".../api") and API_KEY. Override with NOTIFY_ENV / NOTIFY_LOG.
set -u
JOB=${1:-}
case "$JOB" in remind|weekly) ;; *) echo "usage: $0 remind|weekly" >&2; exit 2;; esac
ENV_FILE=${NOTIFY_ENV:-/home/opc/repos/line-bot-fb/functions/.env}
LOG=${NOTIFY_LOG:-/home/opc/devbox/notify.log}

val() { sed -nE "s/^$1[[:space:]]*=[[:space:]]*\"?([^\"]*)\"?[[:space:]]*$/\1/p" "$ENV_FILE" | head -1; }
API_URL=$(val API_URL)
API_KEY=$(val API_KEY)

# The key goes to curl on stdin (-H @-), not on the command line.
out=$(printf 'x-api-key: %s\n' "$API_KEY" | curl -s -m 60 -w ' HTTP %{http_code}' \
  -H @- -H 'Content-Type: application/json' -X POST -d "{\"job\":\"$JOB\"}" "${API_URL}/notify" 2>&1)
echo "$(date -u +%FT%TZ) $JOB $out" >> "$LOG"
tail -n 1000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
