#!/bin/bash
# Keep-warm ping for the LINE bot backend (bug 14).
# Cron runs this every 5 minutes (*/5 * * * * /home/opc/repos/linebot-backend/scripts/keepwarm.sh); a GET to /api/ping keeps the Vercel function
# instance and its Oracle connection alive so users skip the ~4-6 s cold start.
# Reads no data and writes nothing to the DB. Logs only time, status and duration.
# Env file must define API_URL (".../api") and API_KEY. Override with KEEPWARM_ENV / KEEPWARM_LOG.
set -u
ENV_FILE=${KEEPWARM_ENV:-/home/opc/repos/line-bot-fb/functions/.env}
LOG=${KEEPWARM_LOG:-/home/opc/devbox/keepwarm.log}

val() { sed -nE "s/^$1[[:space:]]*=[[:space:]]*\"?([^\"]*)\"?[[:space:]]*$/\1/p" "$ENV_FILE" | head -1; }
API_URL=$(val API_URL)
API_KEY=$(val API_KEY)

# The key goes to curl on stdin (-H @-), not on the command line, so it never
# shows up in the process list.
out=$(printf 'x-api-key: %s\n' "$API_KEY" | curl -s -o /dev/null -m 30 -w '%{http_code} %{time_total}s' \
  -H @- "${API_URL}/ping" 2>&1)
echo "$(date -u +%FT%TZ) $out" >> "$LOG"

# Keep the log small.
tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
