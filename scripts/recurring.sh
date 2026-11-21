#!/bin/bash
# Daily recurring records: POST /api/recurring {"action":"run"} records every
# recurring item that is due (components/recurring.js). Cron on the server:
#   0 0 * * * /home/opc/repos/linebot-backend/scripts/recurring.sh   (07:00 Thai time)
# Logs only time, HTTP status and the counts the API returns.
# Env file must define API_URL (".../api") and API_KEY. Override with RECURRING_ENV / RECURRING_LOG.
set -u
ENV_FILE=${RECURRING_ENV:-/home/opc/repos/line-bot-fb/functions/.env}
LOG=${RECURRING_LOG:-/home/opc/devbox/recurring.log}

val() { sed -nE "s/^$1[[:space:]]*=[[:space:]]*\"?([^\"]*)\"?[[:space:]]*$/\1/p" "$ENV_FILE" | head -1; }
API_URL=$(val API_URL)
API_KEY=$(val API_KEY)

# The key goes to curl on stdin (-H @-), not on the command line.
out=$(printf 'x-api-key: %s\n' "$API_KEY" | curl -s -m 60 -w ' HTTP %{http_code}' \
  -H @- -H 'Content-Type: application/json' -X POST -d '{"action":"run"}' "${API_URL}/recurring" 2>&1)
echo "$(date -u +%FT%TZ) $out" >> "$LOG"
tail -n 1000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
