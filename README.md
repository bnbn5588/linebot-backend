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
- **Only `public/` is static.** `"outputDirectory": "public"` stops Vercel from
  serving the repo's source files; `public/` holds just the LIFF web app.

## Project structure

```
api/index.js          # the only Vercel function: route -> handler
handlers/*.js         # one file per endpoint
components/db.js      # Oracle pool (poolMin/poolMax 1) and query helpers
components/services.js
components/utilities.js  # amount parsing, date checks, help text
apiKeyMiddleware.js   # x-api-key check
scripts/keepwarm.sh   # cron script for /api/ping
public/               # LIFF web app (the only static files Vercel serves)
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
| `GET` | `/api/help` | `lang` (`th` or `en`) | Help content as cards (shown by the bot's `help` / `ช่วยเหลือ`); edit it in `components/help.js` |
| `GET` | `/api/ping` | – | Keep-warm check: runs `SELECT 1 FROM DUAL`, returns `db_ms` |
| `GET` | `/api/admin-overview` | – | Admin site data (LINE ID token of an admin, see [Admin website](#admin-website)) |

Unknown routes return 404, a missing or wrong key returns 403.

### Web app (LIFF) endpoints

These are called by the web page in `public/` and use the user's **LINE ID token**
instead of `API_KEY` (`Authorization: Bearer <liff.getIDToken()>`). The backend
verifies the token with LINE (`https://api.line.me/oauth2/v2.1/verify`) and uses
the verified `sub` (LINE userId) as `uname`, so a user can only read or change
their own records. `API_KEY` must never be put in the web page.

| Method | Endpoint | Parameters | Description |
|---|---|---|---|
| `GET` | `/api/me` | – | Current wallet and all wallets (404 `NO_WALLET` if the user never created one) |
| `GET` | `/api/me-summary` | `wallet_id`, `month` (`YYYY-MM`) | Totals, income/expense/balance per month, totals by note for the month |
| `GET` | `/api/me-transactions` | `wallet_id`, `month`, `q`, `limit` (≤200), `offset` | Records, newest first; `q` searches notes |
| `PUT` | `/api/me-transactions` | body: `id`, `exvalue`, `targetdate`, `detail` | Edit a record |
| `DELETE` | `/api/me-transactions` | `id` | Delete a record |

`wallet_id` is optional (defaults to the current wallet) and must belong to the user.
Invalid or expired tokens return 401.

## Web app (LIFF)

`public/index.html`, `app.js`, `app.css` — a dashboard (monthly balance chart,
totals by note) and a record list with search, edit and delete. It runs inside
LINE (LIFF) or in a desktop browser via `https://liff.line.me/<LIFF ID>`.

Setup in LINE Developers Console:

1. Under the **same provider as the bot's Messaging API channel**, create a
   **LINE Login** channel (LINE user IDs are per provider; another provider gives
   different IDs that will not match `uname`).
2. LIFF tab → Add: size **Full**, scopes `openid` and `profile`, endpoint URL
   `https://bot-backend-three.vercel.app/`.
3. Put the LIFF ID in `public/config.js` and the channel ID in
   `DEFAULT_LOGIN_CHANNEL_ID` (`components/lineAuth.js`) or the
   `LINE_LOGIN_CHANNEL_ID` env var. Neither value is secret.
4. Publish the channel (while it is "Developing" only testers can log in).
5. Optional: add a rich menu button linking to `https://liff.line.me/<LIFF ID>`.

Local testing without LINE: run `local-server.js` with
`LINE_VERIFY_URL` pointing at a stub verifier and open
`http://127.0.0.1:3100/?mocktoken=<token>` (only honored on localhost).

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

## Admin website

A separate site in `admin/` (its own Vercel project, root directory `admin`, no
build step) for the owner: users and activity (counts and dates only, no
amounts), records per day, DB size per table/index and schema quota, runtime
health, LINE OA message quota and followers (needs `LB_KEY`, the bot's channel
access token, in the backend's Vercel env), and links to the Vercel, Firebase,
Google Cloud, OCI and LINE consoles.

- API: `GET /api/admin-overview` — LINE ID token of an admin. Admins are listed
  in `DEFAULT_ADMIN_USER_IDS` (`components/adminAuth.js`) or the `ADMIN_USER_IDS`
  env var; a signed-in non-admin sees their own LINE userId so it can be added.
- CORS: only origins in `DEFAULT_ADMIN_ORIGINS` (`handlers/admin-overview.js`) or
  `ADMIN_ORIGINS` may call it.
- Login: a second LIFF app in the same LINE Login channel, endpoint = the admin
  site URL; its LIFF ID goes in `admin/config.js`.

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
