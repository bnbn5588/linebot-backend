const moment = require("moment-timezone");
const oracledb = require("oracledb");
const { executeQuery } = require("./db");
const { categorize, describe, isValidFor } = require("./categories");
const { budgetAlert } = require("./budget");
const { parseAmount, isTextWithin } = require("./utilities");
const { WEB_APP_URL } = require("./help");
const { push, fmtMoney, clip } = require("./monthlySummary");
const { quotaOk } = require("./notify");

// Recurring records (RECURRING, migration 011): rent, internet, salary...
// Set in the web app (/api/me-recurring); listed by the bot ("ประจำ").
// Every day at 07:00 Thai time the cron (POST /api/recurring {action:"run"})
// records every item that is due today or earlier this month, once per month
// (RECURRING.last_month), dated on its day at 07:00 wallet time. Records it
// makes carry EXPENSE.recurring_id. Items with notify = 1 are listed in one
// LINE message per user, with a button to undo each record.
//
// Days are the wallet's own calendar. Day 29..31 in a shorter month = its
// last day. A missed run (server down) is caught up on the next day of the
// same month; months are never back-filled.

const MAX_PER_WALLET = 30;
const RUN_TIME = "07:00:00";
const UNDO_DAYS = 7;
const NOTE_MAX_BYTES = 250;

const zoneOr = (tz) => (tz && moment.tz.zone(tz) ? tz : "Asia/Bangkok");
const todayIn = (tz, now = new Date()) => moment.tz(now, zoneOr(tz)).format("YYYY-MM-DD");
const nextMonth = (ym) => moment.utc(ym + "-01").add(1, "month").format("YYYY-MM");
const daysIn = (ym) => moment.utc(ym + "-01").daysInMonth();
const dueDay = (ym, day) => Math.min(day, daysIn(ym));
const dueDate = (ym, day) => `${ym}-${String(dueDay(ym, day)).padStart(2, "0")}`;

// First month an item set (or resumed, or moved to another day) today may be
// recorded: this month when its day is still ahead, else next month.
function firstMonth(today, day) {
  const ym = today.slice(0, 7);
  return Number(today.slice(8, 10)) < dueDay(ym, day) ? ym : nextMonth(ym);
}

// YYYY-MM-DD of the next record, or null when paused.
function nextDue(item, today) {
  if (item.paused) return null;
  let ym = today.slice(0, 7);
  if (item.last_month && item.last_month >= ym) ym = nextMonth(item.last_month);
  if (item.start_month > ym) ym = item.start_month;
  return dueDate(ym, item.day_of_month);
}

// Month to record today (YYYY-MM) or null.
function dueMonth(item, today) {
  if (item.paused) return null;
  const ym = today.slice(0, 7);
  if (item.start_month > ym) return null;
  if (item.last_month && item.last_month >= ym) return null;
  if (Number(today.slice(8, 10)) < dueDay(ym, item.day_of_month)) return null;
  return ym;
}

const COLS = "rec_id, exvalue, note, category, day_of_month, notify, paused, start_month, last_month";
function fromRow([rec_id, exvalue, note, category, day_of_month, notify, paused, start_month, last_month]) {
  return { rec_id, exvalue, note, category, day_of_month, notify: notify === 1, paused: paused === 1, start_month, last_month };
}
function publicItem(x, today) {
  return {
    id: x.rec_id, exvalue: x.exvalue, note: x.note, category: describe(x.category, x.exvalue),
    day: x.day_of_month, notify: x.notify, paused: x.paused, next_date: nextDue(x, today),
  };
}

async function listItems(connection, uname, wallet) {
  const r = await executeQuery(
    connection,
    `SELECT ${COLS} FROM recurring WHERE uname = :uname AND wallet_id = :wallet_id ORDER BY day_of_month, rec_id`,
    { uname, wallet_id: wallet.wallet_id }
  );
  const today = todayIn(wallet.timezone);
  return r.rows.map(fromRow).map((x) => publicItem(x, today));
}

// One item of the user, with its wallet's id and time zone.
async function getItem(connection, uname, id) {
  const r = await executeQuery(
    connection,
    `SELECT r.${COLS.split(", ").join(", r.")}, r.wallet_id, w.timezone
       FROM recurring r JOIN wallet w ON w.uname = r.uname AND w.wallet_id = r.wallet_id
      WHERE r.uname = :uname AND r.rec_id = :id`,
    { uname, id }
  );
  if (!r.rows.length) return null;
  return { ...fromRow(r.rows[0]), wallet_id: r.rows[0][9], timezone: r.rows[0][10] };
}

// Checks a create / edit body. Returns { error } or the clean fields.
// partial: only the fields present are checked (edit).
function readItem(body, partial = false) {
  const out = {};
  const has = (k) => body[k] !== undefined;
  if (!partial || has("exvalue")) {
    const v = parseAmount(body.exvalue);
    if (v === null || Math.abs(v) >= 10000000) {
      return { error: "Field 'exvalue' must be a non-zero number with at most 2 decimals and below 10,000,000 (e.g. -8000, +35,000)." };
    }
    out.exvalue = v;
  }
  if (!partial || has("note")) {
    const note = typeof body.note === "string" ? body.note.replace(/\s+/g, " ").trim() : "";
    if (!note) return { error: "Field 'note' is required." };
    if (!isTextWithin(note, NOTE_MAX_BYTES)) return { error: "Field 'note' is too long." };
    out.note = note;
  }
  if (!partial || has("day")) {
    const d = Number(body.day);
    if (!Number.isInteger(d) || d < 1 || d > 31) return { error: "Field 'day' must be a day of the month (1-31)." };
    out.day = d;
  }
  if (has("category") && body.category !== null && body.category !== "") {
    if (typeof body.category !== "string") return { error: "Field 'category' is not a valid category for this amount." };
    out.category = body.category;
  } else if (has("category")) {
    out.category = null; // let the system pick
  }
  for (const k of ["notify", "paused"]) {
    if (has(k)) {
      if (typeof body[k] !== "boolean") return { error: `Field '${k}' must be true or false.` };
      out[k] = body[k];
    }
  }
  return out;
}

// The category to store: the one chosen (must fit the sign), or what the
// bot would pick for the note (#tag removed from the note).
async function pickCategory(connection, uname, note, value, chosen) {
  if (chosen) {
    if (!isValidFor(chosen, value)) return { error: "Field 'category' is not a valid category for this amount." };
    return { note, category: chosen };
  }
  const cat = await categorize(connection, uname, note, value);
  return { note: cat.note || note, category: cat.category };
}

async function createItem(connection, uname, wallet, body) {
  const f = readItem(body);
  if (f.error) return f;
  const count = await executeQuery(
    connection,
    "SELECT COUNT(*) FROM recurring WHERE uname = :uname AND wallet_id = :wallet_id",
    { uname, wallet_id: wallet.wallet_id }
  );
  if (count.rows[0][0] >= MAX_PER_WALLET) return { error: "LIMIT", limit: MAX_PER_WALLET };
  const c = await pickCategory(connection, uname, f.note, f.exvalue, f.category);
  if (c.error) return c;
  const today = todayIn(wallet.timezone);
  // rec_id = MAX + 1 (prod cannot create sequences); two adds at the same
  // moment clash on the primary key, so try again once.
  const insert = () => executeQuery(
    connection,
    `INSERT INTO recurring (rec_id, uname, wallet_id, exvalue, note, category, day_of_month, notify, start_month)
     VALUES ((SELECT NVL(MAX(rec_id), 0) + 1 FROM recurring), :uname, :wallet_id, :exvalue, :note, :category, :day, :notify, :start_month)
     RETURNING rec_id INTO :id`,
    {
      uname, wallet_id: wallet.wallet_id, exvalue: f.exvalue, note: c.note, category: c.category, day: f.day,
      notify: f.notify === false ? 0 : 1, start_month: firstMonth(today, f.day),
      id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    }
  );
  let r;
  try {
    r = await insert();
  } catch (e) {
    if (!/ORA-00001/.test(e.message)) throw e;
    r = await insert();
  }
  const item = await getItem(connection, uname, r.outBinds.id[0]);
  return { item: publicItem(item, today) };
}

// Edit any of exvalue, note, category, day, notify, paused. A new day or a
// resume starts again from firstMonth(); last_month still stops a second
// record in a month already recorded.
async function updateItem(connection, uname, id, body) {
  const old = await getItem(connection, uname, id);
  if (!old) return { error: "NOT_FOUND" };
  const f = readItem(body, true);
  if (f.error) return f;
  const value = f.exvalue ?? old.exvalue;
  let note = f.note ?? old.note;
  let category = old.category;
  if (f.category !== undefined || f.note !== undefined || (f.exvalue !== undefined && (f.exvalue < 0) !== (old.exvalue < 0))) {
    // re-check the category when it, the note or the sign changed
    const keep = f.category !== undefined ? f.category : (isValidFor(old.category, value) ? old.category : null);
    const c = await pickCategory(connection, uname, note, value, keep);
    if (c.error) return c;
    note = c.note;
    category = c.category;
  }
  const day = f.day ?? old.day_of_month;
  const paused = f.paused ?? old.paused;
  const today = todayIn(old.timezone);
  let start = old.start_month;
  if (day !== old.day_of_month || (old.paused && !paused)) start = firstMonth(today, day);
  await executeQuery(
    connection,
    `UPDATE recurring SET exvalue = :exvalue, note = :note, category = :category, day_of_month = :day,
            notify = :notify, paused = :paused, start_month = :start_month, updated_at = SYSDATE
      WHERE uname = :uname AND rec_id = :id`,
    {
      exvalue: value, note, category, day, notify: (f.notify ?? old.notify) ? 1 : 0, paused: paused ? 1 : 0,
      start_month: start, uname, id,
    }
  );
  return { item: publicItem(await getItem(connection, uname, id), today) };
}

async function deleteItem(connection, uname, id) {
  const r = await executeQuery(
    connection,
    "DELETE FROM recurring WHERE uname = :uname AND rec_id = :id",
    { uname, id }
  );
  return r.rowsAffected > 0;
}

// Bot "ยกเลิก" button: deletes a record the cron made (only those).
async function undoRecord(connection, uname, transId) {
  const r = await executeQuery(
    connection,
    "SELECT note, exvalue, TO_CHAR(fulldate, 'YYYY-MM-DD') FROM expense WHERE trans_id = :id AND uname = :uname AND recurring_id IS NOT NULL",
    { id: transId, uname }
  );
  if (!r.rows.length) return null;
  const d = await executeQuery(
    connection,
    "DELETE FROM expense WHERE trans_id = :id AND uname = :uname AND recurring_id IS NOT NULL",
    { id: transId, uname }
  );
  if (!d.rowsAffected) return null;
  return { id: transId, note: r.rows[0][0], exvalue: r.rows[0][1], date: r.rows[0][2] };
}

// ---------- the daily run
// 20 UTF-16 units max (LINE quick reply label), never cutting an emoji.
function labelClip(text, max = 20) {
  if (text.length <= max) return text;
  let out = "";
  for (const ch of Array.from(text)) {
    if (out.length + ch.length > max - 1) break;
    out += ch;
  }
  return out + "…";
}

function budgetLine(b) {
  return b.level === "over"
    ? `⚠️ ${b.label} เกินงบแล้ว (${b.pct}%)`
    : `⚠️ ${b.label} ใช้ไป ${b.pct}% ของงบ`;
}

// One text message for a user's records of the day (notify = 1 only).
// done: [{ trans_id, note, exvalue, wallet_name, budget }]
function runMessage(done, issuedAt = Date.now()) {
  const lines = done.map((d) => `• ${clip(d.note, 60)} ${fmtMoney(d.exvalue)} (กระเป๋า ${clip(d.wallet_name || String(d.wallet_id), 30)})`);
  const warns = done.filter((d) => d.budget).map((d) => budgetLine(d.budget));
  const t = issuedAt.toString(36); // ms, as the bot's other expiring buttons
  const items = done.slice(0, 12).map((d) => ({
    type: "action",
    action: {
      type: "postback",
      label: labelClip(`↩️ ยกเลิก ${d.note}`),
      data: `a=recundo&id=${d.trans_id}&t=${t}`,
      displayText: clip(`ยกเลิก ${d.note} ${fmtMoney(d.exvalue)}`, 60),
    },
  }));
  items.push({ type: "action", action: { type: "uri", label: "🌐 เปิดเว็บ", uri: WEB_APP_URL } });
  return {
    type: "text",
    text: clip(["🔁 บันทึกรายการประจำให้แล้ว", ...lines, ...warns].join("\n"), 4500) +
      `\n\nกด "ยกเลิก" ได้ภายใน ${UNDO_DAYS} วัน ถ้ารายการไหนไม่ได้จ่ายจริง`,
    quickReply: { items },
  };
}

// Records everything due. Returns counts (and the messages when dryRun).
async function runDue(connection, { only = null, dryRun = false, now = new Date() } = {}) {
  const out = { job: "recurring", due: 0, recorded: 0, users_told: 0, failed: 0, push_stopped: null };
  const r = await executeQuery(
    connection,
    `SELECT r.${COLS.split(", ").join(", r.")}, r.uname, r.wallet_id, w.wallet_name, w.timezone
       FROM recurring r JOIN wallet w ON w.uname = r.uname AND w.wallet_id = r.wallet_id AND w.deleted_at IS NULL
      WHERE r.paused = 0 ${only ? "AND r.uname = :only" : ""}
      ORDER BY r.uname, r.day_of_month, r.rec_id`,
    only ? { only } : {}
  );
  const tell = new Map(); // uname -> [record]
  for (const row of r.rows) {
    const x = fromRow(row);
    const [uname, walletId, walletName, tz] = row.slice(9);
    const ym = dueMonth(x, todayIn(tz, now));
    if (!ym) continue;
    out.due++;
    const date = dueDate(ym, x.day_of_month);
    const rec = { rec_id: x.rec_id, wallet_id: walletId, wallet_name: walletName, note: x.note, exvalue: x.exvalue, date };
    if (dryRun) {
      if (x.notify) tell.set(uname, [...(tell.get(uname) || []), { ...rec, trans_id: 0 }]);
      continue;
    }
    const opts = { autoCommit: false };
    try {
      // claim the month first: two runs at once never record it twice
      const claim = await executeQuery(
        connection,
        `UPDATE recurring SET last_month = :ym WHERE rec_id = :id AND paused = 0 AND (last_month IS NULL OR last_month < :ym)`,
        { ym, id: x.rec_id },
        opts
      );
      if (!claim.rowsAffected) { await connection.rollback(); out.due--; continue; }
      const category = x.category && isValidFor(x.category, x.exvalue) ? x.category : (await categorize(connection, uname, x.note, x.exvalue)).category;
      const ins = await executeQuery(
        connection,
        `INSERT INTO expense (uname, exvalue, fulldate, note, wallet_id, category, recurring_id)
         VALUES (:uname, :exvalue, TO_DATE(:d, 'YYYY-MM-DD HH24:MI:SS'), :note, :wallet_id, :category, :rec_id)
         RETURNING trans_id INTO :tid`,
        {
          uname, exvalue: x.exvalue, d: `${date} ${RUN_TIME}`, note: x.note, wallet_id: walletId, category, rec_id: x.rec_id,
          tid: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        },
        opts
      );
      await connection.commit();
      out.recorded++;
      if (!x.notify) continue;
      const budget = await budgetAlert(connection, { uname, walletId, category, date, added: -x.exvalue });
      tell.set(uname, [...(tell.get(uname) || []), { ...rec, trans_id: ins.outBinds.tid[0], budget }]);
    } catch (e) {
      try { await connection.rollback(); } catch { /* ignore */ }
      console.error("recurring record:", e.message);
      out.failed++;
    }
  }
  if (dryRun) {
    return { ...out, messages: [...tell].map(([uname, done]) => ({ uname, message: runMessage(done) })) };
  }
  if (!tell.size) return out;
  // Records are saved either way; only the messages wait for quota.
  if (!process.env.LB_KEY) return { ...out, push_stopped: "NO_LB_KEY" };
  const ok = await quotaOk().catch((e) => { console.error("quota check:", e.message); return null; });
  if (ok === null) return { ...out, push_stopped: "QUOTA_CHECK_FAILED" };
  if (!ok) return { ...out, push_stopped: "QUOTA_90" };
  for (const [uname, done] of tell) {
    try {
      await push(uname, runMessage(done));
      out.users_told++;
    } catch (e) {
      console.error("recurring push:", e.message);
      if (e.status === 429) { out.push_stopped = "QUOTA"; break; }
    }
  }
  return out;
}

module.exports = {
  listItems, createItem, updateItem, deleteItem, undoRecord, runDue, runMessage,
  firstMonth, nextDue, dueMonth, dueDate, labelClip, MAX_PER_WALLET, UNDO_DAYS,
};
