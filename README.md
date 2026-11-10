# Line Bot Backend Service

REST API behind the LINE expense bot ([line-bot-fb](https://github.com/bnbn5588/line-bot-fb)).
It stores wallets and income/expense records in an Oracle Autonomous Database and runs on Vercel.

## Architecture

```
LINE user ─► Firebase Function LineBot (asia-southeast1)
                 │  HTTPS + x-api-key
                 ▼
             Vercel function api/index.js (region hnd1, Tokyo)
                 │  one pooled connection per instance
                 ▼
             Oracle Autonomous DB (ap-tokyo-1)
```

- **One serverless function.** Every endpoint is served by `api/index.js`, which
  dispatches to the handler in `handlers/<name>.js`. `vercel.json` rewrites
  `/api/<name>` to `/api/index?route=<name>`, so the public URLs did not change.
  One function means one cold start and one DB pool for all commands, instead
  of one per endpoint.
- **Tokyo region.** `"regions": ["hnd1"]` keeps the function next to the
  database. Without it Vercel ran the function in `iad1` (US East) and every
  query paid a ~170 ms round trip; in Tokyo a query takes a few ms.
- **Keep-warm.** A cron job sends `GET /api/ping` every 5 minutes so users do
  not hit a cold start (see [Keep-warm](#keep-warm)).
- **No static files.** `"outputDirectory": "public"` (an empty folder) stops
  Vercel from serving the repo's source files as static assets.

## Project structure

```
api/index.js          # the only Vercel function: route -> handler
handlers/*.js         # one file per endpoint
components/db.js      # Oracle pool (poolMin/poolMax 1) and query helpers
components/services.js
components/utilities.js  # amount parsing, date checks, help text
apiKeyMiddleware.js   # x-api-key check
scripts/keepwarm.sh   # cron script for /api/ping
public/               # intentionally empty (static output dir)
vercel.json
```

## API

Every request must send the API key:

```
x-api-key: <API_KEY>
```

| Method | Endpoint | Parameters | Description |
|---|---|---|---|
| `POST` | `/api/add` | body: `uname`, `wallet_id`, `exvalue` (e.g. `-120`, `+1,500.50`), `targetdate` (`YYYY-MM-DD HH:MM:SS`), `detail` | Add an income/expense record; returns the day and month totals |
| `GET` | `/api/sumall` | `uname`, `wallet_id` | Total balance and first record date (404 if the wallet has no records) |
| `GET` | `/api/sumbymonth` | `uname`, `wallet_id` | Balance per month |
| `GET` | `/api/sumbynote` | `uname`, `wallet_id`, optional `month` (`YYYY-MM`) | Totals grouped by note (case-insensitive) |
| `GET` | `/api/sumday` | `uname`, `wallet_id`, `date` | Total for one day |
| `GET` | `/api/wallet` | `userid` | Current wallet |
| `GET` | `/api/wallets` | `userid` | All wallets of a user |
| `POST` | `/api/createWallet` | body: `uname`, `wallet_name`, `timezone` | Create a wallet and make it current (one transaction) |
| `POST` | `/api/changeWallet` | body: `uname`, `wallet_id` | Switch the current wallet |
| `GET` | `/api/help` | – | Command list shown by the bot's `help` |
| `GET` | `/api/ping` | – | Keep-warm check: runs `SELECT 1 FROM DUAL`, returns `db_ms` |

Unknown routes return 404, a missing or wrong key returns 403.

## Environment variables

`.env` (production DB) — never commit it:

```sh
DB_USER="your_db_user"
DB_PASS="your_db_password"
DSN_NAME="your_oracle_connection_string"
API_KEY="your_api_key"
```

On Vercel these are set in Project Settings → Environment Variables.
The **Preview** environment points at the development schema (`DEVUSER`),
so preview deployments never touch production data. Locally, `.env.dev` holds
the development schema credentials (excluded via `.git/info/exclude`).

## Requirements

- Node.js 26.x (pinned in `package.json` `engines`; Vercel no longer runs 20.x)
- An Oracle Autonomous Database (`oracledb` Thin mode, no Instant Client needed)

## Development and testing

```sh
npm install
```

On the maintainer's server the tooling runs in Docker (`~/devbox`), not on the host:

- `local-server.js` serves this repo the same way Vercel routes it
  (`ENV_FILE=.env.dev` to use the development schema).
- `smoke-test.js`, `bot-test.js`, `bot-test-2.js`, `tx-test.js` run end-to-end
  tests against the development schema.

Always test against the development schema, never against production.

## Deployment

- Push to any branch other than `main` → GitHub Actions (`preview.yml`) and the
  Vercel GitHub integration build a **preview** deployment (development DB).
  Run the tests against the preview URL before merging.
- Push to `main` → **production** deployment (`production.yml`).
- Rollback: Vercel dashboard → Deployments → Instant Rollback.

## Keep-warm

`scripts/keepwarm.sh` reads `API_URL` and `API_KEY` from an env file (the bot's
`functions/.env` by default; override with `KEEPWARM_ENV`) and sends `GET /api/ping`.
It logs only time, HTTP status and duration (`KEEPWARM_LOG`, default
`~/devbox/keepwarm.log`, trimmed to 2000 lines).

Cron entry on the server:

```
*/5 * * * * /home/opc/repos/linebot-backend/scripts/keepwarm.sh
```

## License

ISC
