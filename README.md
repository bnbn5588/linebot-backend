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
| `POST` | `/api/manageWallet` | body: `uname`, `action` (`rename` \| `info` \| `delete` \| `trash` \| `restore`), `wallet_id`, `wallet_name` | Rename a wallet, move it to the trash (`wallet_name` must match) or restore it (see [Wallet trash](#wallet-trash)) |
| `POST` | `/api/purge-wallets` | – | Delete wallets trashed more than 30 days ago (daily cron) |
| `GET` | `/api/help` | `lang` (`th` or `en`) | Help content as cards (shown by the bot's `help` / `ช่วยเหลือ`); edit it in `components/help.js` |
| `POST` | `/api/ai-sweep` | body: optional `days`, `max` | Ask Gemini again for recent "other" records (see [Admin website](#admin-website)) |
| `POST` | `/api/monthly-summary` | body: optional `month`, `only`, `force`, `dry_run` | Push last month's summary to every user (see [Monthly summary](#monthly-summary)) |
| `POST` | `/api/summarySetting` | body: `uname`, `on` (true/false), optional `kind` (`monthly` default \| `weekly` \| `remind` \| `nospend`) | Monthly summary, weekly summary or reminder on/off; `nospend` = "no spending today" (see [Reminders](#reminders-and-weekly-summary)) |
| `POST` | `/api/recurring` | body: `action` (`list` \| `undo` \| `run`); `list`/`undo`: `uname` (+ `id` = record id for `undo`); `run`: optional `only`, `dry_run` | Recurring items: the bot's list, its "ยกเลิก" button, and the daily run (see [Recurring records](#recurring-records)) |
| `POST` | `/api/notify` | body: `job` (`remind` \| `weekly`), optional `only`, `force`, `dry_run` | Run the daily reminder or the weekly summary (cron) |
| `GET` | `/api/ping` | – | Keep-warm check: runs `SELECT 1 FROM DUAL`, returns `db_ms` |
| `GET` | `/api/admin-overview` | – | Admin site data (LINE ID token of an admin, see [Admin website](#admin-website)) |
| `GET` `PUT` `DELETE` | `/api/admin-category-map` | PUT `note`, `category`; DELETE `note_key`, `kind` | Shared note → category mapping for all users (admin only) |
| `GET` | `/api/admin-category-guess` | `note`, `kind` (expense\|income), optional `uname` | Which category a note would get and from which step, read-only (admin only) |

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
| `GET` | `/api/me-summary` | `wallet_id`, `month` (`YYYY-MM`), `type`, `category`, `note` | Totals, income/expense/balance per month, totals by note and by category for the month (each note and category with `prev_total`, the month before — only the same days so far when `month` is the current month, see `compare.prev_days` — and `avg_total`, the average of the 3 months before over `compare.avg_months` months with records); with `category` and/or `note` (exact, lower-case trimmed like the by-note list), `filter_months` (also sent as the old name `category_months`); with `month`, `days` — income/expense/balance/count per day of that month that has records (category / note filter applied) |
| `GET` | `/api/me-notes` | `wallet_id` | Every note of the wallet, most used first (`note` key, `count`, `total`, `last` date, and from the newest record `text` as typed, `last_category`, `last_value`); for the "เลือกโน้ต" picker and the note suggestions |
| `GET` | `/api/me-transactions` | `wallet_id`, `month`, `q`, `type`, `category`, `note`, `limit` (≤200), `offset` | Records, newest first; `q` searches notes, `note` is an exact note |
| `PUT` | `/api/me-transactions` | body: `id`, `exvalue`, `targetdate`, `detail` | Edit a record |
| `DELETE` | `/api/me-transactions` | `id` | Delete a record |
| `GET` | `/api/me-notify` | – | Notification switches of the signed-in user: `remind`, `remind_paused`, `weekly`, `monthly` (see [Reminders](#reminders-and-weekly-summary)) |
| `PUT` | `/api/me-notify` | body: `kind` (`remind` \| `weekly` \| `monthly`), `on` (true/false) | Turn one on/off (same columns as the bot commands); returns all switches |
| `GET` | `/api/me-recurring` | `wallet_id` | Recurring items of the wallet (`id`, `exvalue`, `note`, `category`, `day`, `notify`, `paused`, `next_date`) and `limit` |
| `POST` | `/api/me-recurring` | body: `wallet_id`, `exvalue`, `note`, `day` (1–31), optional `category`, `notify` | Add a recurring item (no category: picked from the note) |
| `PUT` | `/api/me-recurring` | body: `id` and any of `exvalue`, `note`, `day`, `category`, `notify`, `paused` | Edit, pause or resume |
| `DELETE` | `/api/me-recurring` | `id` | Delete the item (records already made stay) |
| `GET` | `/api/me-wallets` | – | Wallets with record count and balance, plus `trash` (each with `purge_on`, `days_left`) and `trash_days` |
| `PUT` | `/api/me-wallets` | body: `wallet_id`, `wallet_name` or `restore: true` | Rename a wallet or restore it from the trash |
| `DELETE` | `/api/me-wallets` | `wallet_id` | Move a wallet to the trash (not the last one) |

`wallet_id` is optional (defaults to the current wallet) and must belong to the user.
Invalid or expired tokens return 401.

## Web app (LIFF)

`public/index.html`, `app.js`, `app.css` — a dashboard (balance chart, totals
by note) and a record list with search, edit and delete. The chart card switches
between **รายเดือน** (12 months), **รายวัน** (one bar per day of the selected
month, dashed average of the days so far for รายรับ / รายจ่าย, weekends shaded)
and **ปฏิทิน** (a Monday-first calendar, darker = bigger day); the daily views
show the average per day, the 3 biggest days, and tapping a day shows its
totals with "ดูรายการวันนี้" (scrolls the record list to that day). The choice
is remembered per browser.

Note suggestions: typing in the "โน้ต" field of the record editor
(เพิ่มรายการ / แก้ไขรายการ) or the recurring editor lists up to 5 earlier notes
of the wallet with the same kind (รายจ่าย / รายรับ) that contain the text
(spaces and case ignored; starts-with first, then most used), each with times
used, last date and last amount; an empty field lists the 5 most used. Tapping
one fills the note as last typed and, while adding with "ให้ระบบเดาให้", its
last category. Arrow keys + Enter pick, Esc closes the list. The list sits in
the form (it pushes the fields down, never covers บันทึก / ยกเลิก) and closes when
another field gets the focus. Notes come from
`/api/me-notes`, loaded once per wallet. It runs inside
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
- CORS: only origins in `DEFAULT_ADMIN_ORIGINS` (`components/adminCors.js`) or
  `ADMIN_ORIGINS` may call it.
- Shared category table (`/api/admin-category-map`, table `CATEGORY_MAP`,
  migration `scripts/migrations/002-category-map.sql`): note → category for
  every user, matched on the whole note (lower-case, single spaces). Order when a
  record is saved: `#tag` > the user's own memory > shared table > keywords >
  other. Rows have a source (`admin`, `ai` for future AI suggestions; saving
  a row on the admin site makes it `admin`, `history` = seeded from existing
  records). Only new records are affected; `scripts/backfill-categories.js`
  also uses the table.
- Try a note (`/api/admin-category-guess`, card "ลองเดาหมวด" on the admin site):
  runs the same steps as a real add (`explain()` in `components/categories.js`)
  without saving anything, and shows every step — including the keyword that
  matched and the shared-table row's source — even after an earlier step won.
  "ถาม AI" (`?ai=1`) shows Gemini's suggestion; saving it stores a source `ai` row.
- AI fill (`components/aiFill.js`, env `GEMINI_API_KEY`, optional `GEMINI_MODEL`,
  `AI_DAILY_CAP` default 200): when `/api/add` finds no category, the record is
  saved as other and answered right away; then (Vercel `waitUntil`,
  `components/background.js`) Gemini is asked once per note — only the note
  text and expense/income are sent. The answer goes into `CATEGORY_MAP`
  (source `ai`, `updated_by` `auto`, `confidence`, `model`; migration 003). With
  confidence >= 0.7 the record gets the category and later records use it via
  the shared table; below that the row is "AI ไม่แน่ใจ" (pending, not used,
  not asked again) until an admin confirms it on the admin site. Gemini
  errors store nothing, so the next record retries.
- User corrections: when a user changes a category by hand (LIFF edit, the
  bot's category picker, or the remembered-notes page) to something other
  than an automatic AI row's answer, that row becomes "ผู้ใช้แก้หมวด"
  (`updated_by` `disputed`): not used for anyone, not asked again, until an
  admin confirms or changes it. Admin and history rows are never touched.
- Daily catch-up (`components/aiSweep.js`, `POST /api/ai-sweep`, API key,
  optional body `days` 1-31 default 7, `max` 1-50 default 20): records of the
  last `days` days still "other" whose note has no shared-table row (Gemini
  failed or the cap was reached when they were saved) are asked again, once
  per note, with the same rules and daily cap; QUOTA stops the run. Returns
  counts only. Server cron runs `scripts/ai-sweep.sh` at 03:00 Thai time
  (`0 20 * * *`), log `~/devbox/ai-sweep.log`.
- Gemini usage (card "Gemini (AI จัดหมวด)" on the admin site, `ai` in
  `/api/admin-overview`): every Gemini question — automatic and "ถาม AI" — adds
  to a per-day counter in `AI_USAGE` (migration 004; origin, outcome, questions,
  HTTP requests incl. retries, total ms; no notes or user ids). Days are Thai days.
  Google's own free-tier quota is shown in AI Studio, not here.
- Seed from existing records: `node scripts/seed-category-map.js [--min=5]
  [--share=0.6] [--apply]` — notes used at least `min` times get their most
  common category (skipping "other" and notes whose records disagree); existing
  rows are never changed. Dry run by default.
- Login: a second LIFF app in the same LINE Login channel, endpoint = the admin
  site URL; its LIFF ID goes in `admin/config.js`.

- Times: the admin site and API show Thai time (Asia/Bangkok). The DB clock
  is UTC, so `updated_at` columns hold UTC and are converted when read
  (`components/thaiTime.js`); "today" (AI cap, usage, 7/30-day counts) is the
  Thai day. Record dates (`EXPENSE.fulldate`) are the wallet's local time as
  entered and are shown as they are.

## Monthly summary

`components/monthlySummary.js`, migration 005 (`USERS.summary_off`,
`USERS.summary_sent`). On the 1st at 09:00 Thai time the server cron runs
`scripts/monthly-summary.sh` (`0 2 1 * *`, log `~/devbox/monthly-summary.log`),
which calls `POST /api/monthly-summary`. Every user with records in the month
before gets one LINE push message: a card per wallet (carousel, up to 5) with
income, expense, balance, total expense vs the month before, and the 3 expense
categories with the most spending, each vs the month before. Needs `LB_KEY`
(the bot's channel access token) in the backend's Vercel env; each user costs
one message of the LINE OA monthly quota (a 429 stops the run).

- Users turn it off/on in the bot: "ปิดสรุปรายเดือน" / "เปิดสรุปรายเดือน" (or
  "summary off" / "summary on").
- `summary_sent` holds the last month sent, so a rerun never sends twice;
  `force: true` resends, `only: <uname>` sends to one user (tests),
  `dry_run: true` returns the messages and sends nothing.

## Wallet trash

`components/walletAdmin.js`, migration 009 (`WALLET.deleted_at`). Deleting a
wallet (bot: "ลบกระเป๋า" / "delete wallet" with a confirm card; web: ⚙ next to
the wallet picker) only sets `deleted_at`: the wallet disappears from every list
and cannot be used, but its records and budgets stay. It can be restored for 30
days (bot: "ถังขยะ" / "กู้กระเป๋า" / "trash"; web: the trash section of ⚙).
The last remaining wallet cannot be deleted; if the current wallet is deleted,
the user switches to another one. Trashed wallets keep their id, so a new
wallet never reuses it.

Every day at 03:30 Thai time the server cron runs `scripts/purge-wallets.sh`
(`30 20 * * *`, log `~/devbox/purge-wallets.log`), which calls
`POST /api/purge-wallets`: wallets trashed more than 30 days ago are deleted for
good with their records, budgets and remembered categories no longer used.

## Reminders and weekly summary

`components/notify.js`, migration 010 (`USERS.remind_on`, `remind_last`,
`remind_skip`, `remind_streak`, `weekly_on`, `weekly_sent`). Both are off until
the user turns them on in the bot (or with the buttons on the help card):

| Bot command | Effect |
|---|---|
| "เปิดเตือนจด" / "remind on" | Daily reminder on |
| "ปิดเตือนจด" / "remind off" | Daily reminder off |
| "เปิดสรุปรายสัปดาห์" / "weekly on" | Weekly summary on |
| "ปิดสรุปรายสัปดาห์" / "weekly off" | Weekly summary off |

The web app's 🔔 button (next to ⚙ in the top bar) opens "การแจ้งเตือน" with
switches for the reminder, the weekly summary and the monthly summary
(`/api/me-notify`, the same `USERS` columns as the bot commands, so both stay in
step; per user, not per wallet). It says when the reminder is paused after 7
days with no record, and shows how many of the current wallet's recurring items
notify in LINE, with a link to the "รายการประจำ" card (set per item there).

- **Reminder** — every day at 21:00 Thai time (`0 14 * * *`,
  `scripts/notify.sh remind`). A user gets a push only if they have no record
  today (in their current wallet's timezone) in any wallet and did not press
  "วันนี้ไม่ได้ใช้เงิน" (no spending today). After 7 reminders in a row with no
  record the reminders pause until the user records again; the 7th message
  says so.
- **Weekly summary** — every Monday at 09:00 Thai time (`0 2 * * 1`,
  `scripts/notify.sh weekly`): a card per wallet for last Monday–Sunday with
  income, expense and the top 3 categories, each vs the week before.
  `weekly_sent` makes a rerun never send twice.
- Both jobs log to `~/devbox/notify.log` (counts only). Each message uses the
  LINE OA monthly push quota; a job stops at 90% of the quota, or when the quota
  cannot be read (`QUOTA_CHECK_FAILED`).
- `POST /api/notify` takes `only: <uname>` (tests), `dry_run: true` (return the
  messages, send nothing) and `force: true` (ignore "already sent").

The web app's budget card also shows "⚡ ใช้เร็วกว่ากำหนด" for the current month
when the share of the budget used is at least 15 points ahead of the share of
the month passed.

## Recurring records

`components/recurring.js`, migration 011 (table `RECURRING`, column
`EXPENSE.recurring_id`). Users set items that repeat every month (rent,
internet, salary) in the web app's "รายการประจำ" card: amount, note, category,
day of the month (1–31; a shorter month uses its last day) and whether to be
told in LINE. At most 30 items per wallet (adds lock the wallet row, so two
at once cannot pass the limit). The bot's "ประจำ" / "recurring"
lists the current wallet's items.

- Every day at 07:00 Thai time the server cron runs `scripts/recurring.sh`
  (`0 0 * * *`, log `~/devbox/recurring.log`), which calls
  `POST /api/recurring {"action":"run"}`. Each item due today or earlier this
  month (the wallet's calendar) is recorded once per month
  (`RECURRING.last_month`), dated on its day at 07:00 wallet time (or the
  current time when it is not 07:00 there yet, so never in the future), with
  `EXPENSE.recurring_id` set. A missed day is caught up the next day in the same
  month; earlier months are never back-filled.
- A new item, a resumed one or one moved to another day starts this month if
  its day is still ahead, otherwise next month.
- Items with notify on are listed in one LINE message per user, with budget
  warnings and a "ยกเลิก" button per record (valid 7 days; it deletes only
  records the run made). LINE allows 13 buttons: the first 12 records get one
  (the message says the rest can be changed in the web app), plus "เปิดเว็บ".
  A list too long for one message ends with "…และอีก N รายการ" at a whole line. Records are saved even when the push quota is at 90%;
  only the message is skipped.
- Records made by the run do not count as "recorded today" for the 21:00
  reminder. The web app marks them with 🔁. Items of a trashed wallet are
  skipped, and are deleted when the wallet is purged.

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

Other server cron jobs (all times UTC): `0 2 1 * *` `monthly-summary.sh`,
`30 20 * * *` `purge-wallets.sh`, `0 14 * * *` `notify.sh remind`,
`0 2 * * 1` `notify.sh weekly`, `0 0 * * *` `recurring.sh`, `0 20 * * *` `ai-sweep.sh`.

## License

ISC
