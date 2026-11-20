#!/bin/bash
# Daily purge: POST /api/purge-wallets deletes for good every wallet that has
# been in the trash (deleted from the bot or web) for 30 days, with its records
# and budgets (components/walletAdmin.js). Cron on the server, once a day:
#   30 20 * * * /home/opc/repos/linebot-backend/scripts/purge-wallets.sh   (03:30 Thai time)
# Logs only time, HTTP status and the counts the API returns.
# Env file must define API_URL (".../api") and API_KEY. Override with PURGE_ENV / PURGE_LOG.
set -u
ENV_FILE=${PURGE_ENV:-/home/opc/repos/line-bot-fb/functions/.env}
LOG=${PURGE_LOG:-/home/opc/devbox/purge-wallets.log}

val() { sed -nE "s/^$1[[:space:]]*=[[:space:]]*\"?([^\"]*)\"?[[:space:]]*$/\1/p" "$ENV_FILE" | head -1; }
API_URL=$(val API_URL)
API_KEY=$(val API_KEY)

# The key goes to curl on stdin (-H @-), not on the command line.
out=$(printf 'x-api-key: %s\n' "$API_KEY" | curl -s -m 60 -w ' HTTP %{http_code}' \
  -H @- -H 'Content-Type: application/json' -X POST -d '{}' "${API_URL}/purge-wallets" 2>&1)
echo "$(date -u +%FT%TZ) $out" >> "$LOG"
tail -n 1000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
