const moment = require("moment-timezone");
const { executeQuery } = require("./db");
const { describe } = require("./categories");
const { WEB_APP_URL } = require("./help");
const { push, row, small, change, fmtMoney, clip, CAT_EXPR } = require("./monthlySummary");

// Opt-in pushes (migration 010), run by cron through POST /api/notify:
//   job "remind": every day at 21:00 Thai time — "you have not recorded anything today"
//   job "weekly": Mondays at 09:00 Thai time — last week's summary card
// Both use the LINE push quota (monthly summary too), so they stop when 90%
// of the month's quota is used.

const REMIND_PAUSE_AFTER = 7; // reminders in a row without a record, then pause
const QUOTA_STOP = 0.9;
const MAX_WALLETS = 5;
const TH_DAYS = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

const zoneOr = (tz) => (tz && moment.tz.zone(tz) ? tz : "Asia/Bangkok");
const dayLabel = (d) => { const m = moment.utc(d); return `${m.date()} ${TH_MONTHS[m.month()]}`; };

// true when pushing is fine; false when 90% of a limited monthly quota is used.
async function quotaOk() {
  if (process.env.NOTIFY_SKIP_QUOTA === "1") return true; // tests
  const base = process.env.LINE_API_BASE || "https://api.line.me";
  const get = async (path) => {
    const r = await fetch(base + path, { headers: { Authorization: `Bearer ${process.env.LB_KEY}` }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`LINE ${path} HTTP ${r.status}`);
    return r.json();
  };
  const [q, used] = await Promise.all([get("/v2/bot/message/quota"), get("/v2/bot/message/quota/consumption")]);
  if (q.type !== "limited") return true;
  return used.totalUsage < q.value * QUOTA_STOP;
}

// ---------- settings (bot commands)
// kind: remind | weekly; on: true/false. "nospend": today needs no reminder.
async function setNotify(connection, uname, kind, on) {
  const col = kind === "remind" ? "remind_on" : "weekly_on";
  const extra = kind === "remind" && on ? ", remind_streak = 0" : "";
  const r = await executeQuery(
    connection,
    `UPDATE users SET ${col} = ${on ? `NVL(${col}, SYSDATE)` : "NULL"}${extra} WHERE uname = :uname`,
    { uname }
  );
  return r.rowsAffected > 0;
}

async function currentTz(connection, uname) {
  const r = await executeQuery(
    connection,
    "SELECT w.timezone FROM users u JOIN wallet w ON w.uname = u.uname AND w.wallet_id = u.wallet_id WHERE u.uname = :uname",
    { uname }
  );
  return zoneOr(r.rows[0] && r.rows[0][0]);
}

async function markNoSpend(connection, uname) {
  const today = moment.tz(await currentTz(connection, uname)).format("YYYY-MM-DD");
  const r = await executeQuery(
    connection,
    "UPDATE users SET remind_skip = :today, remind_streak = 0 WHERE uname = :uname",
    { today, uname }
  );
  return r.rowsAffected > 0 ? today : null;
}

// ---------- reminder
function remindMessage(streak) {
  const last = streak >= REMIND_PAUSE_AFTER;
  return {
    type: "text",
    text: "📝 วันนี้ยังไม่ได้จดรายการเลยนะ\nพิมพ์ เช่น \"-120 ข้าวกลางวัน\" ได้เลย" +
      (last ? `\n\nเตือนมา ${REMIND_PAUSE_AFTER} วันติดแล้ว จะหยุดเตือนไว้ก่อน พอกลับมาจดจะเตือนต่อให้เอง` : ""),
    quickReply: { items: [
      { type: "action", action: { type: "postback", label: "🙅 วันนี้ไม่ได้ใช้เงิน", data: "a=nospend&id=0", displayText: "วันนี้ไม่ได้ใช้เงิน" } },
      { type: "action", action: { type: "uri", label: "🌐 เปิดเว็บ", uri: WEB_APP_URL } },
      { type: "action", action: { type: "message", label: "🔕 ปิดเตือนจด", text: "ปิดเตือนจด" } },
    ] },
  };
}

async function sendReminders(connection, { only = null, dryRun = false, now = new Date() } = {}) {
  const out = { job: "remind", users: 0, sent: 0, recorded: 0, skipped: 0, paused: 0, failed: 0, stopped: null };
  if (!dryRun && !process.env.LB_KEY) return { ...out, stopped: "NO_LB_KEY" };
  if (!dryRun && !(await quotaOk())) return { ...out, stopped: "QUOTA_90" };
  const users = await executeQuery(
    connection,
    `SELECT u.uname, w.timezone, u.remind_last, u.remind_skip, u.remind_streak
       FROM users u LEFT JOIN wallet w ON w.uname = u.uname AND w.wallet_id = u.wallet_id
      WHERE u.remind_on IS NOT NULL ${only ? "AND u.uname = :only" : ""}
      ORDER BY u.uname`,
    only ? { only } : {}
  );
  out.users = users.rows.length;
  const messages = [];
  for (const [uname, tz, last, skip, streak] of users.rows) {
    const today = moment.tz(now, zoneOr(tz)).format("YYYY-MM-DD");
    if (last === today || skip === today) { out.skipped++; continue; }
    // any record dated today, in any of the user's active wallets
    const rec = await executeQuery(
      connection,
      `SELECT COUNT(*) FROM expense e JOIN wallet w ON w.uname = e.uname AND w.wallet_id = e.wallet_id AND w.deleted_at IS NULL
        WHERE e.uname = :uname AND e.fulldate >= TO_DATE(:today, 'YYYY-MM-DD') AND e.fulldate < TO_DATE(:today, 'YYYY-MM-DD') + 1`,
      { uname, today }
    );
    if (rec.rows[0][0] > 0) {
      out.recorded++;
      if (streak && !dryRun) await executeQuery(connection, "UPDATE users SET remind_streak = 0 WHERE uname = :uname", { uname });
      continue;
    }
    if (streak >= REMIND_PAUSE_AFTER) { out.paused++; continue; }
    const msg = remindMessage(streak + 1);
    if (dryRun) { messages.push({ uname, message: msg }); continue; }
    try {
      await push(uname, msg);
    } catch (e) {
      console.error("reminder push:", e.message);
      out.failed++;
      if (e.status === 429) { out.stopped = "QUOTA"; break; }
      continue;
    }
    await executeQuery(
      connection,
      "UPDATE users SET remind_last = :today, remind_streak = remind_streak + 1 WHERE uname = :uname",
      { today, uname }
    );
    out.sent++;
  }
  return dryRun ? { ...out, messages } : out;
}

// ---------- weekly summary (Monday..Sunday of last week, Thai calendar)
function lastWeek(now = new Date()) {
  const today = moment.tz(now, "Asia/Bangkok").startOf("day");
  const thisMon = today.clone().subtract((today.day() + 6) % 7, "days");
  const start = thisMon.clone().subtract(7, "days");
  const fmt = (m) => m.format("YYYY-MM-DD");
  return { start: fmt(start), end: fmt(thisMon), prevStart: fmt(start.clone().subtract(7, "days")) };
}

async function weekSummaries(connection, uname, w) {
  const b = { uname, s: w.start, e: w.end };
  const IN = "e.fulldate >= TO_DATE(:s, 'YYYY-MM-DD') AND e.fulldate < TO_DATE(:e, 'YYYY-MM-DD')";
  const totals = await executeQuery(
    connection,
    `SELECT e.wallet_id, w.wallet_name,
            sum(CASE WHEN e.exvalue > 0 THEN e.exvalue ELSE 0 END),
            sum(CASE WHEN e.exvalue < 0 THEN e.exvalue ELSE 0 END), count(*)
       FROM expense e JOIN wallet w ON w.uname = e.uname AND w.wallet_id = e.wallet_id AND w.deleted_at IS NULL
      WHERE e.uname = :uname AND ${IN}
      GROUP BY e.wallet_id, w.wallet_name
      ORDER BY count(*) DESC, e.wallet_id
      FETCH FIRST ${MAX_WALLETS} ROWS ONLY`,
    b
  );
  if (!totals.rows.length) return [];
  const pb = { uname, s: w.prevStart, e: w.start };
  const prevExp = new Map((await executeQuery(
    connection,
    `SELECT e.wallet_id, sum(e.exvalue) FROM expense e WHERE e.uname = :uname AND e.exvalue < 0 AND ${IN} GROUP BY e.wallet_id`,
    pb
  )).rows);
  const cat = CAT_EXPR.replace(/\b(category|exvalue)\b/g, "e.$1");
  const cats = (await executeQuery(
    connection,
    `SELECT e.wallet_id, ${cat}, sum(e.exvalue) FROM expense e WHERE e.uname = :uname AND e.exvalue < 0 AND ${IN} GROUP BY e.wallet_id, ${cat}`,
    b
  )).rows;
  const prevCats = new Map((await executeQuery(
    connection,
    `SELECT e.wallet_id || '|' || ${cat}, sum(e.exvalue) FROM expense e WHERE e.uname = :uname AND e.exvalue < 0 AND ${IN} GROUP BY e.wallet_id, ${cat}`,
    pb
  )).rows);
  return totals.rows.map(([walletId, name, income, expense, count]) => ({
    wallet_id: walletId, wallet_name: name, income, expense, count,
    balance: Math.round((income + expense) * 100) / 100,
    prev_expense: prevExp.get(walletId) || 0,
    top: cats.filter((c) => c[0] === walletId).sort((x, y) => x[2] - y[2]).slice(0, 3)
      .map(([, k, total]) => ({ ...describe(k, -1), total, prev_total: prevCats.get(`${walletId}|${k}`) || 0 })),
  }));
}

function weekLabel(w) {
  const last = moment.utc(w.end).subtract(1, "day").format("YYYY-MM-DD");
  return `${dayLabel(w.start)} – ${dayLabel(last)}`;
}

function weekBubble(x, w) {
  const spent = -x.expense, before = -x.prev_expense;
  const vs = change(spent, before);
  const contents = [
    { type: "text", text: "🗓️ สรุปสัปดาห์ที่แล้ว", weight: "bold", size: "md", color: "#0b0b0b" },
    { type: "text", text: `${TH_DAYS[1]} ${weekLabel(w)}`, size: "xs", color: "#52514e" },
    { type: "text", text: clip(`[${x.wallet_id}] ${x.wallet_name || ""}`.trim(), 40) + ` · ${x.count} รายการ`, size: "xs", color: "#52514e" },
    { type: "separator", margin: "md" },
    { type: "box", layout: "vertical", spacing: "xs", margin: "md", contents: [
      row("รายรับ", fmtMoney(x.income), "#256abf"),
      row("รายจ่าย", fmtMoney(x.expense), "#d03b3b"),
      row("คงเหลือ", fmtMoney(x.balance), x.balance < 0 ? "#d03b3b" : "#256abf", true),
    ] },
    small(spent
      ? (vs ? `รายจ่ายเทียบสัปดาห์ก่อน (${fmtMoney(x.prev_expense)}): ${vs}` : "สัปดาห์ก่อนไม่มีรายจ่าย")
      : "สัปดาห์นี้ไม่มีรายจ่าย"),
  ];
  if (x.top.length) {
    contents.push({ type: "separator", margin: "md" });
    contents.push({ type: "text", text: "ใช้มากสุด", size: "xs", color: "#52514e", margin: "md" });
    for (const c of x.top) {
      const cv = change(-c.total, -c.prev_total);
      contents.push({ type: "box", layout: "vertical", contents: [
        row(`${c.icon} ${c.label}`, fmtMoney(c.total)),
        small(cv ? `สัปดาห์ก่อน ${fmtMoney(c.prev_total)} · ${cv}` : "สัปดาห์ก่อนไม่มี"),
      ] });
    }
  }
  return {
    type: "bubble",
    size: "kilo",
    body: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "16px", contents },
    footer: { type: "box", layout: "vertical", spacing: "xs", paddingAll: "12px", paddingTop: "0px", contents: [
      { type: "button", style: "primary", height: "sm", color: "#256abf",
        action: { type: "uri", label: "📊 ดูบนเว็บ", uri: `${WEB_APP_URL}?wallet=${encodeURIComponent(x.wallet_id)}&month=${w.start.slice(0, 7)}` } },
      { type: "button", style: "link", height: "sm", color: "#77766f",
        action: { type: "message", label: "🔕 ปิดสรุปรายสัปดาห์", text: "ปิดสรุปรายสัปดาห์" } },
    ] },
  };
}

function weekMessage(wallets, w) {
  const total = wallets.reduce((a, x) => a + x.expense, 0);
  const bubbles = wallets.map((x) => weekBubble(x, w));
  return {
    type: "flex",
    altText: clip(`สรุปสัปดาห์ ${weekLabel(w)}: รายจ่าย ${fmtMoney(total)}`, 400),
    contents: bubbles.length === 1 ? bubbles[0] : { type: "carousel", contents: bubbles },
  };
}

async function sendWeeklySummaries(connection, { only = null, dryRun = false, force = false, now = new Date() } = {}) {
  const w = lastWeek(now);
  const out = { job: "weekly", week: w.start, users: 0, sent: 0, skipped_no_records: 0, failed: 0, stopped: null };
  if (!dryRun && !process.env.LB_KEY) return { ...out, stopped: "NO_LB_KEY" };
  if (!dryRun && !(await quotaOk())) return { ...out, stopped: "QUOTA_90" };
  const users = await executeQuery(
    connection,
    `SELECT uname FROM users WHERE weekly_on IS NOT NULL
        ${force ? "" : "AND (weekly_sent IS NULL OR weekly_sent < :week)"}
        ${only ? "AND uname = :only" : ""} ORDER BY uname`,
    { ...(force ? {} : { week: w.start }), ...(only ? { only } : {}) }
  );
  out.users = users.rows.length;
  const messages = [];
  for (const [uname] of users.rows) {
    const wallets = await weekSummaries(connection, uname, w);
    if (!wallets.length) { out.skipped_no_records++; continue; }
    const msg = weekMessage(wallets, w);
    if (dryRun) { messages.push({ uname, message: msg }); continue; }
    try {
      await push(uname, msg);
    } catch (e) {
      console.error("weekly summary push:", e.message);
      out.failed++;
      if (e.status === 429) { out.stopped = "QUOTA"; break; }
      continue;
    }
    await executeQuery(connection, "UPDATE users SET weekly_sent = :week WHERE uname = :uname", { week: w.start, uname });
    out.sent++;
  }
  return dryRun ? { ...out, messages } : out;
}

module.exports = { setNotify, markNoSpend, sendReminders, sendWeeklySummaries, lastWeek, weekMessage, remindMessage, quotaOk, REMIND_PAUSE_AFTER };
