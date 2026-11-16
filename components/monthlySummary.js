const crypto = require("crypto");
const { executeQuery } = require("./db");
const { describe } = require("./categories");
const { WEB_APP_URL } = require("./help");
const { getBudgets } = require("./budget");

// Monthly summary pushed to each user on the 1st (scripts/monthly-summary.sh
// → POST /api/monthly-summary). One LINE message per user: a card per wallet
// that has records in the month (a carousel when there are several) with
// income / expense / balance, total expense vs the month before, and the 3
// expense categories with the most spending, each vs the month before, and
// each category budget's use (components/budget.js).
// Users who typed "ปิดสรุปรายเดือน" (USERS.summary_off) are skipped;
// USERS.summary_sent stops the same month from being sent twice.
// Migration 005.

const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const MAX_WALLETS = 5; // cards per message
const MAX_BUDGETS = 6; // budget rows per card
const CAT_EXPR = "NVL(category, CASE WHEN exvalue > 0 THEN 'other_income' ELSE 'other_expense' END)";
const IN_MONTH = "fulldate >= TO_DATE(:month, 'YYYY-MM') AND fulldate < ADD_MONTHS(TO_DATE(:month, 'YYYY-MM'), 1)";
const IN_PREV = "fulldate >= ADD_MONTHS(TO_DATE(:month, 'YYYY-MM'), -1) AND fulldate < TO_DATE(:month, 'YYYY-MM')";

const monthLabel = (m) => `${TH_MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
function prevMonthOf(m) {
  const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7));
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
}
// The month before today's month in Thailand
function lastMonth(now = new Date()) {
  const th = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit" }).format(now);
  return prevMonthOf(th.slice(0, 7));
}

const fmtMoney = (v, signed = true) => {
  const n = Math.round((Number(v) || 0) * 100) / 100;
  const s = Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n < 0 ? "−" + s : (signed && n > 0 ? "+" : "") + s;
};
const clip = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + "…" : String(t));

// "▲ ใช้มากขึ้น 12%" for spending (both values are positive amounts spent)
function change(now, before) {
  if (!before) return null;
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return "เท่าเดิม";
  const size = Math.abs(pct) >= 1000 ? `${Math.round(now / before)} เท่า` : `${Math.abs(pct)}%`;
  return pct > 0 ? `▲ ใช้มากขึ้น ${size}` : `▼ ใช้น้อยลง ${size}`;
}

// Per wallet of one user for `month`: totals, previous month's expense and
// the top 3 expense categories (with last month's amount for each).
async function walletSummaries(connection, uname, month) {
  const b = { uname, month };
  const totals = await executeQuery(
    connection,
    `SELECT e.wallet_id, w.wallet_name,
            sum(CASE WHEN e.exvalue > 0 THEN e.exvalue ELSE 0 END),
            sum(CASE WHEN e.exvalue < 0 THEN e.exvalue ELSE 0 END),
            count(*)
       FROM expense e
       LEFT JOIN wallet w ON w.uname = e.uname AND w.wallet_id = e.wallet_id
      WHERE e.uname = :uname AND ${IN_MONTH.replace(/fulldate/g, "e.fulldate")}
      GROUP BY e.wallet_id, w.wallet_name
      ORDER BY count(*) DESC, e.wallet_id
      FETCH FIRST ${MAX_WALLETS} ROWS ONLY`,
    b
  );
  if (!totals.rows.length) return [];
  const prevExp = new Map((await executeQuery(
    connection,
    `SELECT wallet_id, sum(exvalue) FROM expense
      WHERE uname = :uname AND exvalue < 0 AND ${IN_PREV} GROUP BY wallet_id`,
    b
  )).rows);
  const cats = (await executeQuery(
    connection,
    `SELECT wallet_id, ${CAT_EXPR}, sum(exvalue) FROM expense
      WHERE uname = :uname AND exvalue < 0 AND ${IN_MONTH}
      GROUP BY wallet_id, ${CAT_EXPR}`,
    b
  )).rows;
  const prevCats = new Map((await executeQuery(
    connection,
    `SELECT wallet_id || '|' || ${CAT_EXPR}, sum(exvalue) FROM expense
      WHERE uname = :uname AND exvalue < 0 AND ${IN_PREV}
      GROUP BY wallet_id, ${CAT_EXPR}`,
    b
  )).rows);
  const budgets = new Map();
  for (const [walletId] of totals.rows) budgets.set(walletId, await getBudgets(connection, uname, walletId, month));
  return totals.rows.map(([walletId, name, income, expense, count]) => ({
    wallet_id: walletId,
    wallet_name: name,
    income,
    expense,
    balance: Math.round((income + expense) * 100) / 100,
    count,
    prev_expense: prevExp.get(walletId) || 0,
    top: cats
      .filter((c) => c[0] === walletId)
      .sort((x, y) => x[2] - y[2])
      .slice(0, 3)
      .map(([, cat, total]) => ({ ...describe(cat, -1), total, prev_total: prevCats.get(`${walletId}|${cat}`) || 0 })),
    budgets: budgets.get(walletId) || [],
  }));
}

function row(label, value, color = "#0b0b0b", bold = false) {
  return {
    type: "box", layout: "horizontal", contents: [
      { type: "text", text: label, size: "sm", color: "#77766f", flex: 0 },
      { type: "text", text: value, size: "sm", color, align: "end", ...(bold ? { weight: "bold" } : {}) },
    ],
  };
}
const small = (text) => ({ type: "text", text, size: "xxs", color: "#77766f", wrap: true });

function bubble(w, month) {
  const spent = -w.expense, before = -w.prev_expense;
  const vs = change(spent, before);
  const prevName = monthLabel(prevMonthOf(month));
  const contents = [
    { type: "text", text: `📊 สรุปเดือน ${monthLabel(month)}`, weight: "bold", size: "md", color: "#0b0b0b" },
    { type: "text", text: clip(`[${w.wallet_id}] ${w.wallet_name || ""}`.trim(), 40) + ` · ${w.count} รายการ`, size: "xs", color: "#52514e" },
    { type: "separator", margin: "md" },
    { type: "box", layout: "vertical", spacing: "xs", margin: "md", contents: [
      row("รายรับ", fmtMoney(w.income), "#256abf"),
      row("รายจ่าย", fmtMoney(w.expense), "#d03b3b"),
      row("คงเหลือ", fmtMoney(w.balance), w.balance < 0 ? "#d03b3b" : "#256abf", true),
    ] },
    small(spent
      ? (vs ? `รายจ่ายเทียบ ${prevName} (${fmtMoney(w.prev_expense)}): ${vs}` : `${prevName} ไม่มีรายจ่าย`)
      : "เดือนนี้ไม่มีรายจ่าย"),
  ];
  if (w.top.length) {
    contents.push({ type: "separator", margin: "md" });
    contents.push({ type: "text", text: "ใช้มากสุด", size: "xs", color: "#52514e", margin: "md" });
    for (const c of w.top) {
      const cv = change(-c.total, -c.prev_total);
      contents.push({ type: "box", layout: "vertical", contents: [
        row(`${c.icon} ${c.label}`, fmtMoney(c.total)),
        small(cv ? `${prevName} ${fmtMoney(c.prev_total)} · ${cv}` : `${prevName} ไม่มี`),
      ] });
    }
  }
  if (w.budgets && w.budgets.length) {
    contents.push({ type: "separator", margin: "md" });
    contents.push({ type: "text", text: "งบรายเดือน", size: "xs", color: "#52514e", margin: "md" });
    for (const b of w.budgets.slice(0, MAX_BUDGETS)) {
      const over = b.spent > b.amount;
      contents.push({ type: "box", layout: "vertical", contents: [
        row(`${b.icon} ${b.label}`, `${fmtMoney(b.spent, false)} / ${fmtMoney(b.amount, false)}`, over ? "#d03b3b" : "#0b0b0b"),
        small(over ? `เกินงบ ${fmtMoney(b.spent - b.amount, false)} (${b.pct}%)` : `ใช้ไป ${b.pct}% · เหลือ ${fmtMoney(b.amount - b.spent, false)}`),
      ] });
    }
    if (w.budgets.length > MAX_BUDGETS) contents.push(small(`และอีก ${w.budgets.length - MAX_BUDGETS} หมวด ดูในเว็บ`));
  }
  return {
    type: "bubble",
    size: "kilo",
    body: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "16px", contents },
    footer: { type: "box", layout: "vertical", spacing: "xs", paddingAll: "12px", paddingTop: "0px", contents: [
      // the web app opens on this wallet and month (public/app.js reads ?wallet=&month=)
      { type: "button", style: "primary", height: "sm", color: "#256abf",
        action: { type: "uri", label: "📊 ดูรายละเอียดบนเว็บ", uri: `${WEB_APP_URL}?wallet=${encodeURIComponent(w.wallet_id)}&month=${month}` } },
      { type: "button", style: "link", height: "sm", color: "#77766f",
        action: { type: "message", label: "🔕 ปิดสรุปรายเดือน", text: "ปิดสรุปรายเดือน" } },
    ] },
  };
}

function message(wallets, month) {
  const total = wallets.reduce((a, w) => a + w.expense, 0);
  const bubbles = wallets.map((w) => bubble(w, month));
  return {
    type: "flex",
    altText: clip(`สรุปเดือน ${monthLabel(month)}: รายจ่าย ${fmtMoney(total)}`, 400),
    contents: bubbles.length === 1 ? bubbles[0] : { type: "carousel", contents: bubbles },
  };
}

async function push(to, msg) {
  const r = await fetch(`${process.env.LINE_API_BASE || "https://api.line.me"}/v2/bot/message/push`, { // LINE_API_BASE: tests only
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.LB_KEY}`,
      "Content-Type": "application/json",
      "X-Line-Retry-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({ to, messages: [msg] }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) {
    const e = new Error(`LINE push HTTP ${r.status}`);
    e.status = r.status;
    throw e;
  }
}

// Returns counts (and the messages when dryRun). only: one uname (tests);
// force: send even if this month was already sent.
async function sendMonthlySummaries(connection, { month = lastMonth(), only = null, dryRun = false, force = false } = {}) {
  const out = { month, users: 0, sent: 0, skipped_no_records: 0, failed: 0, stopped: null };
  if (!dryRun && !process.env.LB_KEY) return { ...out, stopped: "NO_LB_KEY" };
  const users = await executeQuery(
    connection,
    `SELECT uname FROM users
      WHERE summary_off IS NULL
        ${force ? "" : "AND (summary_sent IS NULL OR summary_sent < :month)"}
        ${only ? "AND uname = :only" : ""}
      ORDER BY uname`,
    { ...(force ? {} : { month }), ...(only ? { only } : {}) }
  );
  out.users = users.rows.length;
  const messages = [];
  for (const [uname] of users.rows) {
    const wallets = await walletSummaries(connection, uname, month);
    if (!wallets.length) { out.skipped_no_records++; continue; }
    const msg = message(wallets, month);
    if (dryRun) { messages.push({ uname, message: msg }); continue; }
    try {
      await push(uname, msg);
    } catch (e) {
      console.error("monthly summary push:", e.message);
      out.failed++;
      if (e.status === 429) { out.stopped = "QUOTA"; break; } // monthly message quota used up
      continue;
    }
    await executeQuery(connection, "UPDATE users SET summary_sent = :month WHERE uname = :uname", { month, uname });
    out.sent++;
  }
  return dryRun ? { ...out, messages } : out;
}

// "ปิดสรุปรายเดือน" / "เปิดสรุปรายเดือน". Returns false if the user has no row.
async function setSummary(connection, uname, on) {
  const r = await executeQuery(
    connection,
    `UPDATE users SET summary_off = ${on ? "NULL" : "NVL(summary_off, SYSDATE)"} WHERE uname = :uname`,
    { uname }
  );
  return r.rowsAffected > 0;
}

module.exports = { sendMonthlySummaries, setSummary, walletSummaries, message, lastMonth, prevMonthOf };
