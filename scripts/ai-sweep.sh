#!/bin/bash
# Daily AI catch-up: POST /api/ai-sweep asks Gemini again for recent records
# still "other" because Gemini failed when they were saved
# (components/aiSweep.js). Cron on the server, once a day:
#   0 20 * * * /home/opc/repos/linebot-backend/scripts/ai-sweep.sh   (03:00 Thai time)
# Logs only time, HTTP status and the counts the API returns (no notes).
# Env file must define API_URL (".../api") and API_KEY. Override with AISWEEP_ENV / AISWEEP_LOG.
set -u
ENV_FILE=${AISWEEP_ENV:-/home/opc/repos/line-bot-fb/functions/.env}
LOG=${AISWEEP_LOG:-/home/opc/devbox/ai-sweep.log}

val() { sed -nE "s/^$1[[:space:]]*=[[:space:]]*\"?([^\"]*)\"?[[:space:]]*$/\1/p" "$ENV_FILE" | head -1; }
API_URL=$(val API_URL)
API_KEY=$(val API_KEY)

# The key goes to curl on stdin (-H @-), not on the command line.
out=$(printf 'x-api-key: %s\n' "$API_KEY" | curl -s -m 70 -w ' HTTP %{http_code}' \
  -H @- -H 'Content-Type: application/json' -X POST -d '{}' "${API_URL}/ai-sweep" 2>&1)
echo "$(date -u +%FT%TZ) $out" >> "$LOG"
tail -n 1000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
