#!/bin/bash
# Monthly summary: POST /api/monthly-summary pushes last month's summary to
# every user (components/monthlySummary.js). Cron on the server, on the 1st:
#   0 2 1 * * /home/opc/repos/linebot-backend/scripts/monthly-summary.sh   (09:00 Thai time)
# Logs only time, HTTP status and the counts the API returns (no amounts).
# Env file must define API_URL (".../api") and API_KEY. Override with MSUMMARY_ENV / MSUMMARY_LOG.
set -u
ENV_FILE=${MSUMMARY_ENV:-/home/opc/repos/line-bot-fb/functions/.env}
LOG=${MSUMMARY_LOG:-/home/opc/devbox/monthly-summary.log}

val() { sed -nE "s/^$1[[:space:]]*=[[:space:]]*\"?([^\"]*)\"?[[:space:]]*$/\1/p" "$ENV_FILE" | head -1; }
API_URL=$(val API_URL)
API_KEY=$(val API_KEY)

# The key goes to curl on stdin (-H @-), not on the command line.
out=$(printf 'x-api-key: %s\n' "$API_KEY" | curl -s -m 70 -w ' HTTP %{http_code}' \
  -H @- -H 'Content-Type: application/json' -X POST -d '{}' "${API_URL}/monthly-summary" 2>&1)
echo "$(date -u +%FT%TZ) $out" >> "$LOG"
tail -n 1000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
