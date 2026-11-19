const {
  executeQuery,
  getConnection,
  closeConnection,
} = require("../components/db");
const { resolveWallet } = require("../components/services");
const { lineAuth } = require("../components/lineAuth");
const { parseAmount, isValidDateTime } = require("../components/utilities");
const { buildTxFilter, txOrder } = require("../components/txFilter");
const { categorize, remember, disputeAi, describe, isValidFor, forgetIfUnused } = require("../components/categories");
const oracledb = require("oracledb");
const { afterResponse } = require("../components/background");
const { aiFill, aiSkipReason } = require("../components/aiFill");
const { budgetAlert } = require("../components/budget");

// /api/me-transactions — the signed-in user's records.
//   GET    ?wallet_id=&month=YYYY-MM&q=text&limit=50&offset=0   list (newest first)
//          &type=income|expense&category=<key>&note=<by-note key, exact>
//          &sort=new|old|amount_desc|amount_asc (default new)
//          (no month + note or q: first page also has by_month [{ month, count, total }];
//           with a month: first page also has by_day [{ day: YYYY-MM-DD, count, total }])
//   POST   body { wallet_id, exvalue, targetdate: "YYYY-MM-DD HH:MM:SS", detail, category? }   add
//          (no category: picked like the bot's add — #tag > memory > shared > keyword, AI after)
//   PUT    body { id, exvalue, targetdate: "YYYY-MM-DD HH:MM:SS", detail, category? }   edit
//   DELETE ?id=   delete
// Every statement is scoped by uname from the verified LINE token, so a user
// can only see or change their own records.

const NOTE_MAX_BYTES = 250; // EXPENSE.NOTE is VARCHAR2(250 BYTE); Thai is 3 bytes/char

function badRequest(res, message) {
  return res.status(400).json({ status: "error", message });
}

async function list(req, res, connection, uname) {
  const { wallet_id, month, q, type, category, id, note } = req.query;
  const f = buildTxFilter({ month, type, category, note, q });
  if (f.error) return badRequest(res, f.error);
  const order = txOrder(req.query.sort);
  if (!order) return badRequest(res, "Parameter 'sort' must be new, old, amount_desc or amount_asc.");
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const wallet = await resolveWallet(connection, uname, wallet_id);
  if (!wallet) {
    return res.status(404).json({ status: "error", message: "Wallet not found" });
  }

  const binds = { uname, wallet_id: wallet.wallet_id, offset, fetch: limit + 1, ...f.binds };
  let filters = f.sql;
  if (id !== undefined && id !== "") {
    if (!/^\d{1,15}$/.test(id)) {
      return badRequest(res, "Parameter 'id' must be a number.");
    }
    filters += " AND trans_id = :id";
    binds.id = Number(id);
  }

  const result = await executeQuery(
    connection,
    `SELECT trans_id, exvalue, TO_CHAR(fulldate, 'YYYY-MM-DD HH24:MI:SS'), note, category
       FROM expense
      WHERE uname = :uname AND wallet_id = :wallet_id${filters}
      ORDER BY ${order}
      OFFSET :offset ROWS FETCH NEXT :fetch ROWS ONLY`,
    binds
  );
  const rows = result.rows.slice(0, limit);
  // All months with a note or search: totals per month (first page only),
  // for the month headers and the "N รายการ ใน M เดือน" line.
  let byMonth;
  if (!month && offset === 0 && ((note !== undefined && note !== "") || (q && q.trim()))) {
    const { offset: _o, fetch: _f, ...sumBinds } = binds;
    const m = await executeQuery(
      connection,
      `SELECT TO_CHAR(fulldate, 'YYYY-MM'), count(*), sum(exvalue)
         FROM expense
        WHERE uname = :uname AND wallet_id = :wallet_id${filters}
        GROUP BY TO_CHAR(fulldate, 'YYYY-MM')
        ORDER BY 1 DESC`,
      sumBinds
    );
    byMonth = m.rows.map(([ym, count, total]) => ({ month: ym, count, total }));
  }
  // One month: totals per day (first page only), for the day headers.
  let byDay;
  if (month && offset === 0) {
    const { offset: _o, fetch: _f, ...sumBinds } = binds;
    const d = await executeQuery(
      connection,
      `SELECT TO_CHAR(fulldate, 'YYYY-MM-DD'), count(*), sum(exvalue)
         FROM expense
        WHERE uname = :uname AND wallet_id = :wallet_id${filters}
        GROUP BY TO_CHAR(fulldate, 'YYYY-MM-DD')
        ORDER BY 1 DESC`,
      sumBinds
    );
    byDay = d.rows.map(([day, count, total]) => ({ day, count, total }));
  }
  return res.status(200).json({
    status: "success",
    data: {
      wallet,
      transactions: rows.map((r) => ({ id: r[0], exvalue: r[1], datetime: r[2], note: r[3], category: describe(r[4], r[1]) })),
      has_more: result.rows.length > limit,
      offset,
      limit,
      ...(byMonth ? { by_month: byMonth } : {}),
      ...(byDay ? { by_day: byDay } : {}),
    },
  });
}

// Shared checks for add / edit -> { value, note } or { error }
function readRecord({ exvalue, targetdate, detail, category }) {
  const value = parseAmount(exvalue);
  if (value === null) {
    return { error: "Field 'exvalue' must be a non-zero number with at most 2 decimals and below 10,000,000 (e.g. -120, +1,500.50)." };
  }
  if (!isValidDateTime(targetdate)) return { error: "Field 'targetdate' must be a valid 'YYYY-MM-DD HH:MM:SS'." };
  const note = typeof detail === "string" ? detail.replace(/\s+/g, " ").trim() : "";
  if (!note) return { error: "Field 'detail' is required." };
  if (Buffer.byteLength(note, "utf8") > NOTE_MAX_BYTES) return { error: "Field 'detail' is too long." };
  if (category !== undefined && category !== null && category !== "") {
    if (typeof category !== "string" || !isValidFor(category, value)) {
      return { error: "Field 'category' is not a valid category for this amount." };
    }
  }
  return { value, note };
}

async function create(req, res, connection, uname) {
  const body = req.body || {};
  const { wallet_id, targetdate, category } = body;
  if (wallet_id !== undefined && wallet_id !== null && wallet_id !== "" && !/^\d{1,9}$/.test(String(wallet_id))) {
    return badRequest(res, "Field 'wallet_id' must be a number.");
  }
  const r = readRecord(body);
  if (r.error) return badRequest(res, r.error);
  const { value } = r;
  const wallet = await resolveWallet(connection, uname, wallet_id === undefined || wallet_id === null || wallet_id === "" ? undefined : String(wallet_id));
  if (!wallet) {
    return res.status(404).json({ status: "error", message: "Wallet not found" });
  }

  // Same as the bot's add: a recognised #tag is removed from the stored note.
  // A category chosen in the form wins and is remembered for this note.
  const cat = await categorize(connection, uname, r.note, value);
  const note = cat.note || r.note;
  let chosen = null;
  if (category) {
    chosen = category;
    await remember(connection, uname, note, category);
    if (category !== cat.category) await disputeAi(connection, note, category);
  }
  const finalCategory = chosen || cat.category;
  const source = chosen ? "user" : cat.source;

  const ins = await executeQuery(
    connection,
    `INSERT INTO expense(uname, exvalue, fulldate, note, wallet_id, category)
     VALUES (:uname, :exvalue, TO_DATE(:targetdate, 'YYYY-MM-DD HH24:MI:SS'), :note, :wallet_id, :category)
     RETURNING trans_id INTO :id`,
    {
      uname, exvalue: value, targetdate, note, wallet_id: wallet.wallet_id, category: finalCategory,
      id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    }
  );
  if (!ins.rowsAffected) {
    return res.status(500).json({ status: "error", message: "Failed to add record." });
  }
  const id = ins.outBinds.id[0];
  // Nothing found a category: ask AI after responding (as the bot's add)
  let aiPending = false;
  if (source === "fallback") {
    aiPending = !(await aiSkipReason(connection, note, value));
    if (aiPending) await afterResponse(() => aiFill({ uname, id, note, amount: value }));
  }
  const budget = await budgetAlert(connection, {
    uname, walletId: Number(wallet.wallet_id), category: finalCategory, date: targetdate.slice(0, 10), added: -value,
  });
  return res.status(200).json({
    status: "success",
    data: {
      id,
      wallet_id: wallet.wallet_id,
      exvalue: value,
      datetime: targetdate,
      note,
      category: { ...describe(finalCategory, value), source, ...(aiPending ? { ai_pending: true } : {}) },
      ...(budget ? { budget } : {}),
    },
  });
}

async function update(req, res, connection, uname) {
  const { id, exvalue, targetdate, detail, category } = req.body || {};
  if (!/^\d{1,15}$/.test(String(id ?? ""))) {
    return badRequest(res, "Field 'id' is required.");
  }
  const value = parseAmount(exvalue);
  if (value === null) {
    return badRequest(
      res,
      "Field 'exvalue' must be a non-zero number with at most 2 decimals and below 10,000,000 (e.g. -120, +1,500.50)."
    );
  }
  if (!isValidDateTime(targetdate)) {
    return badRequest(res, "Field 'targetdate' must be a valid 'YYYY-MM-DD HH:MM:SS'.");
  }
  const note = typeof detail === "string" ? detail.replace(/\s+/g, " ").trim() : "";
  if (!note) {
    return badRequest(res, "Field 'detail' is required.");
  }
  if (Buffer.byteLength(note, "utf8") > NOTE_MAX_BYTES) {
    return badRequest(res, "Field 'detail' is too long.");
  }

  if (category !== undefined && category !== null && category !== "") {
    if (typeof category !== "string" || !isValidFor(category, value)) {
      return badRequest(res, "Field 'category' is not a valid category for this amount.");
    }
  }

  const current = await executeQuery(
    connection,
    "SELECT category FROM expense WHERE trans_id = :id AND uname = :uname",
    { id: Number(id), uname }
  );
  if (!current.rows.length) {
    return res.status(404).json({ status: "error", message: "Record not found" });
  }

  // Category: the one chosen in the form (and remember it for this note);
  // otherwise keep the old one if it still fits the sign; otherwise pick again.
  let newCategory;
  if (category) {
    newCategory = category;
    await remember(connection, uname, note, category);
    // only a real change (the form also sends the category when it was left as is)
    if (category !== current.rows[0][0]) await disputeAi(connection, note, category);
  } else if (current.rows[0][0] && isValidFor(current.rows[0][0], value)) {
    newCategory = current.rows[0][0];
  } else {
    newCategory = (await categorize(connection, uname, note, value)).category;
  }

  const result = await executeQuery(
    connection,
    `UPDATE expense
        SET exvalue = :exvalue,
            fulldate = TO_DATE(:targetdate, 'YYYY-MM-DD HH24:MI:SS'),
            note = :note,
            category = :category
      WHERE trans_id = :id AND uname = :uname`,
    { exvalue: value, targetdate, note, category: newCategory, id: Number(id), uname }
  );
  if (!result.rowsAffected) {
    return res.status(404).json({ status: "error", message: "Record not found" });
  }
  return res.status(200).json({
    status: "success",
    data: { id: Number(id), exvalue: value, datetime: targetdate, note, category: describe(newCategory, value) },
  });
}

async function remove(req, res, connection, uname) {
  const id = req.query.id;
  if (!/^\d{1,15}$/.test(String(id ?? ""))) {
    return badRequest(res, "Parameter 'id' is required.");
  }
  const found = await executeQuery(
    connection,
    "SELECT note FROM expense WHERE trans_id = :id AND uname = :uname",
    { id: Number(id), uname }
  );
  if (!found.rows.length) {
    return res.status(404).json({ status: "error", message: "Record not found" });
  }
  const result = await executeQuery(
    connection,
    "DELETE FROM expense WHERE trans_id = :id AND uname = :uname",
    { id: Number(id), uname }
  );
  if (!result.rowsAffected) {
    return res.status(404).json({ status: "error", message: "Record not found" });
  }
  const forgot = await forgetIfUnused(connection, uname, found.rows[0][0]);
  return res.status(200).json({ status: "success", data: { id: Number(id), memory_forgotten: forgot } });
}

const methods = { GET: list, POST: create, PUT: update, DELETE: remove };

module.exports = async (req, res) => {
  const action = Object.hasOwn(methods, req.method) ? methods[req.method] : null;
  if (!action) {
    return res.status(405).json({ status: "error", message: "Use GET, POST, PUT or DELETE." });
  }
  return lineAuth(req, res, async (uname) => {
    let connection;
    try {
      connection = await getConnection();
      await action(req, res, connection, uname);
    } catch (error) {
      console.error(`Error in /me-transactions ${req.method}:`, error.message);
      res.status(500).json({ status: "error", message: "Internal Server Error" });
    } finally {
      await closeConnection(connection);
    }
  });
};
