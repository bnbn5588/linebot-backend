const moment = require("moment-timezone");
const { executeQuery } = require("./db");
const { lastWeek, REMIND_PAUSE_AFTER } = require("./notify");
const { lastMonth } = require("./monthlySummary");
const { TRASH_DAYS } = require("./walletAdmin");

// Admin site card "การแจ้งเตือนและงานอัตโนมัติ": counts only (no names, notes
// or amounts) for the scheduled jobs, plus "late" counts that suggest a cron
// job did not run. Days and times are Thai (every cron is set in Thai time);
// a wallet in another time zone can make a "late" count off by one day.
//   remind   21:00 daily      weekly   Mon 09:00      monthly  1st 09:00
//   recurring 07:00 daily     purge    03:30 daily
// Each part is null when its migration is not there yet.
const GRACE_MIN = 60; // a job counts as late this long after its start time

const thai = (now) => moment.tz(now, "Asia/Bangkok");
const after = (t, hhmm) => t.format("HH:mm") >= hhmm;
const plusGrace = (hhmm) => moment.utc(hhmm, "HH:mm").add(GRACE_MIN, "minutes").format("HH:mm");
// DB dates (remind_on, weekly_on, SYSDATE) are UTC: Thai = UTC + 7 h
const ANY_REC = `FROM expense e JOIN wallet w ON w.uname = e.uname AND w.wallet_id = e.wallet_id AND w.deleted_at IS NULL
  WHERE e.uname = u.uname`;
// the reminder ignores records the recurring run made
const ACTIVE_REC = `${ANY_REC} AND e.recurring_id IS NULL`;

async function optional(fn) {
  try {
    return await fn();
  } catch (e) {
    if (/ORA-00904|ORA-00942/.test(e.message)) return null; // column / table not there yet
    throw e;
  }
}
const one = async (c, sql, b = {}) => (await executeQuery(c, sql, b)).rows[0];

async function remind(c, t) {
  // the last run that should have happened: today's when past 21:00 + grace
  const ref = (after(t, plusGrace("21:00")) ? t.clone() : t.clone().subtract(1, "day")).format("YYYY-MM-DD");
  const [on, paused, lastDay] = await one(c,
    `SELECT count(*),
            count(CASE WHEN u.remind_streak >= :max AND NOT EXISTS (SELECT 1 ${ACTIVE_REC}
                         AND e.fulldate >= TO_DATE(u.remind_last, 'YYYY-MM-DD')) THEN 1 END),
            max(u.remind_last)
       FROM users u WHERE u.remind_on IS NOT NULL`, { max: REMIND_PAUSE_AFTER });
  const [lastSent] = lastDay ? await one(c, "SELECT count(*) FROM users WHERE remind_on IS NOT NULL AND remind_last = :d", { d: lastDay }) : [0];
  // users the run of `ref` should have reminded but did not (on before 21:00
  // Thai = 14:00 UTC that day, not paused — a record since the last reminder
  // un-pauses — not "วันนี้ไม่ได้ใช้เงิน", no record that day)
  const [late] = await one(c,
    `SELECT count(*) FROM users u
      WHERE u.remind_on IS NOT NULL AND u.remind_on < TO_DATE(:ref, 'YYYY-MM-DD') + 14/24
        AND (u.remind_streak < :max OR EXISTS (SELECT 1 ${ACTIVE_REC}
              AND e.fulldate >= TO_DATE(u.remind_last, 'YYYY-MM-DD')))
        AND (u.remind_last IS NULL OR u.remind_last < :ref)
        AND (u.remind_skip IS NULL OR u.remind_skip <> :ref)
        AND NOT EXISTS (SELECT 1 ${ACTIVE_REC}
              AND e.fulldate >= TO_DATE(:ref, 'YYYY-MM-DD') AND e.fulldate < TO_DATE(:ref, 'YYYY-MM-DD') + 1)`,
    { ref, max: REMIND_PAUSE_AFTER });
  return { on, paused, last_day: lastDay || null, last_sent: lastSent, check_day: ref, late };
}

async function weekly(c, t) {
  const w = lastWeek(t.toDate());
  const due = t.day() !== 1 || after(t, plusGrace("09:00")); // this Monday's run is done
  const week = due ? w.start : lastWeek(t.clone().subtract(1, "day").toDate()).start;
  const end = moment.utc(week).add(7, "days").format("YYYY-MM-DD");
  const [on, sent, late] = await one(c,
    `SELECT count(*),
            count(CASE WHEN u.weekly_sent >= :week THEN 1 END),
            count(CASE WHEN (u.weekly_sent IS NULL OR u.weekly_sent < :week)
                        AND u.weekly_on < TO_DATE(:end, 'YYYY-MM-DD') + 2/24
                        AND EXISTS (SELECT 1 ${ANY_REC}
                              AND e.fulldate >= TO_DATE(:week, 'YYYY-MM-DD') AND e.fulldate < TO_DATE(:end, 'YYYY-MM-DD')) THEN 1 END)
       FROM users u WHERE u.weekly_on IS NOT NULL`, { week, end });
  return { on, week, sent, late };
}

async function monthly(c, t) {
  const due = t.date() !== 1 || after(t, plusGrace("09:00"));
  const month = due ? lastMonth(t.toDate()) : lastMonth(t.clone().subtract(1, "day").toDate());
  const start = `${month}-01`;
  const [users, off, sent, late] = await one(c,
    `SELECT count(*), count(u.summary_off),
            count(CASE WHEN u.summary_sent >= :month THEN 1 END),
            count(CASE WHEN u.summary_off IS NULL AND (u.summary_sent IS NULL OR u.summary_sent < :month)
                        AND EXISTS (SELECT 1 ${ANY_REC}
                              AND e.fulldate >= TO_DATE(:s, 'YYYY-MM-DD') AND e.fulldate < ADD_MONTHS(TO_DATE(:s, 'YYYY-MM-DD'), 1)) THEN 1 END)
       FROM users u`, { month, s: start });
  return { month, users, on: users - off, sent, late };
}

async function recurring(c, t) {
  const r = await executeQuery(c,
    `SELECT r.uname, r.day_of_month, r.notify, r.paused, r.start_month, r.last_month
       FROM recurring r JOIN wallet w ON w.uname = r.uname AND w.wallet_id = r.wallet_id AND w.deleted_at IS NULL`, {});
  const month = t.format("YYYY-MM");
  const today = t.date(), dim = t.daysInMonth();
  const ran = after(t, plusGrace("07:00"));
  const out = { items: r.rows.length, active: 0, paused: 0, notify: 0, users: new Set(), recorded: 0, due_left: 0, late: 0, pushes_left: new Set() };
  for (const [uname, day, notify, paused, start, last] of r.rows) {
    out.users.add(uname);
    if (paused) { out.paused++; continue; }
    out.active++;
    if (notify) out.notify++;
    if (start > month) continue;
    if (last === month) { out.recorded++; continue; }
    const due = Math.min(day, dim);
    if (due < today || (due === today && ran)) out.late++;
    else {
      out.due_left++;
      if (notify) out.pushes_left.add(`${uname}|${due}`); // one message per user and day
    }
  }
  return { ...out, users: out.users.size, pushes_left: out.pushes_left.size };
}

async function trash(c) {
  const [wallets, purgeOn, late] = await one(c,
    `SELECT count(*), TO_CHAR(min(deleted_at) + ${TRASH_DAYS}, 'YYYY-MM-DD'),
            count(CASE WHEN deleted_at + ${TRASH_DAYS} + 1 <= SYSDATE THEN 1 END)
       FROM wallet WHERE deleted_at IS NOT NULL`);
  return { wallets, next_purge: purgeOn, late };
}

// Upper bound of the pushes still to come this month (LINE counts per month):
// a reminder every evening to every user with it on and not paused, the weekly
// card every Monday, and one recurring message per user and due day.
function pushForecast(t, { remind: rm, weekly: wk, monthly: mo, recurring: rc }) {
  const end = t.clone().endOf("month");
  let evenings = end.date() - t.date() + (after(t, "21:00") ? 0 : 1);
  let mondays = 0;
  for (let d = t.clone().startOf("day"); d.isSameOrBefore(end, "day"); d.add(1, "day")) {
    if (d.day() === 1 && (!d.isSame(t, "day") || !after(t, "09:00"))) mondays++;
  }
  const reminders = rm ? Math.max(0, rm.on - rm.paused) * evenings : 0;
  const weeklyCards = wk ? wk.on * mondays : 0;
  const recurringMsgs = rc ? rc.pushes_left : 0;
  // the monthly summary is still to come only on the 1st before 09:00
  const monthlyMsgs = mo && t.date() === 1 && !after(t, "09:00") ? mo.on : 0;
  return { reminders, weekly: weeklyCards, monthly: monthlyMsgs, recurring: recurringMsgs, total: reminders + weeklyCards + monthlyMsgs + recurringMsgs };
}

async function jobsStatus(connection, now = new Date()) {
  const t = thai(now);
  const out = {
    now_th: t.format("YYYY-MM-DD HH:mm"),
    remind: await optional(() => remind(connection, t)),
    weekly: await optional(() => weekly(connection, t)),
    monthly: await optional(() => monthly(connection, t)),
    recurring: await optional(() => recurring(connection, t)),
    trash: await optional(() => trash(connection)),
  };
  out.push_forecast = pushForecast(t, out);
  return out;
}

// Per user: which features they use (for the users table), by uname.
async function featureFlags(connection) {
  const flags = {};
  const get = (u) => (flags[u] = flags[u] || { budget: false, recurring: 0, remind: false, weekly: false });
  const users = await optional(() => executeQuery(connection,
    "SELECT uname, CASE WHEN remind_on IS NULL THEN 0 ELSE 1 END, CASE WHEN weekly_on IS NULL THEN 0 ELSE 1 END FROM users", {}));
  for (const [u, r, w] of users ? users.rows : []) Object.assign(get(u), { remind: !!r, weekly: !!w });
  const budgets = await optional(() => executeQuery(connection,
    `SELECT DISTINCT b.uname FROM budget b JOIN wallet w ON w.uname = b.uname AND w.wallet_id = b.wallet_id AND w.deleted_at IS NULL`, {}));
  for (const [u] of budgets ? budgets.rows : []) get(u).budget = true;
  const recs = await optional(() => executeQuery(connection,
    `SELECT r.uname, count(*) FROM recurring r JOIN wallet w ON w.uname = r.uname AND w.wallet_id = r.wallet_id AND w.deleted_at IS NULL
      WHERE r.paused = 0 GROUP BY r.uname`, {}));
  for (const [u, n] of recs ? recs.rows : []) get(u).recurring = n;
  return flags;
}

module.exports = { jobsStatus, featureFlags, pushForecast, GRACE_MIN };
