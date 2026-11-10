const {
  executeQuery,
  getConnection,
  closeConnection,
} = require("../components/db");
const { resolveWallet } = require("../components/services");
const { lineAuth } = require("../components/lineAuth");
const { parseAmount, isValidDateTime } = require("../components/utilities");

// /api/me-transactions — the signed-in user's records.
//   GET    ?wallet_id=&month=YYYY-MM&q=text&limit=50&offset=0   list (newest first)
//   PUT    body { id, exvalue, targetdate: "YYYY-MM-DD HH:MM:SS", detail }   edit
//   DELETE ?id=   delete
// Every statement is scoped by uname from the verified LINE token, so a user
// can only see or change their own records.

const NOTE_MAX_BYTES = 250; // EXPENSE.NOTE is VARCHAR2(250 BYTE); Thai is 3 bytes/char

function badRequest(res, message) {
  return res.status(400).json({ status: "error", message });
}

async function list(req, res, connection, uname) {
  const { wallet_id, month, q } = req.query;
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return badRequest(res, "Parameter 'month' must be in 'YYYY-MM' format.");
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const wallet = await resolveWallet(connection, uname, wallet_id);
  if (!wallet) {
    return res.status(404).json({ status: "error", message: "Wallet not found" });
  }

  const binds = { uname, wallet_id: wallet.wallet_id, offset, fetch: limit + 1 };
  let filters = "";
  if (month) {
    filters +=
      " AND fulldate >= TO_DATE(:month, 'YYYY-MM') AND fulldate < ADD_MONTHS(TO_DATE(:month, 'YYYY-MM'), 1)";
    binds.month = month;
  }
  if (q && q.length > 100) {
    return badRequest(res, "Parameter 'q' is too long.");
  }
  if (q && q.trim()) {
    // Escape LIKE wildcards so the search is a plain "contains"
    const term = q.trim().toLowerCase().replace(/[\\%_]/g, (c) => "\\" + c);
    filters += " AND lower(note) LIKE :q ESCAPE '\\'";
    binds.q = `%${term}%`;
  }

  const result = await executeQuery(
    connection,
    `SELECT trans_id, exvalue, TO_CHAR(fulldate, 'YYYY-MM-DD HH24:MI:SS'), note
       FROM expense
      WHERE uname = :uname AND wallet_id = :wallet_id${filters}
      ORDER BY fulldate DESC, trans_id DESC
      OFFSET :offset ROWS FETCH NEXT :fetch ROWS ONLY`,
    binds
  );
  const rows = result.rows.slice(0, limit);
  return res.status(200).json({
    status: "success",
    data: {
      wallet,
      transactions: rows.map((r) => ({ id: r[0], exvalue: r[1], datetime: r[2], note: r[3] })),
      has_more: result.rows.length > limit,
      offset,
      limit,
    },
  });
}

async function update(req, res, connection, uname) {
  const { id, exvalue, targetdate, detail } = req.body || {};
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
  const note = typeof detail === "string" ? detail.trim() : "";
  if (!note) {
    return badRequest(res, "Field 'detail' is required.");
  }
  if (Buffer.byteLength(note, "utf8") > NOTE_MAX_BYTES) {
    return badRequest(res, "Field 'detail' is too long.");
  }

  const result = await executeQuery(
    connection,
    `UPDATE expense
        SET exvalue = :exvalue,
            fulldate = TO_DATE(:targetdate, 'YYYY-MM-DD HH24:MI:SS'),
            note = :note
      WHERE trans_id = :id AND uname = :uname`,
    { exvalue: value, targetdate, note, id: Number(id), uname }
  );
  if (!result.rowsAffected) {
    return res.status(404).json({ status: "error", message: "Record not found" });
  }
  return res.status(200).json({
    status: "success",
    data: { id: Number(id), exvalue: value, datetime: targetdate, note },
  });
}

async function remove(req, res, connection, uname) {
  const id = req.query.id;
  if (!/^\d{1,15}$/.test(String(id ?? ""))) {
    return badRequest(res, "Parameter 'id' is required.");
  }
  const result = await executeQuery(
    connection,
    "DELETE FROM expense WHERE trans_id = :id AND uname = :uname",
    { id: Number(id), uname }
  );
  if (!result.rowsAffected) {
    return res.status(404).json({ status: "error", message: "Record not found" });
  }
  return res.status(200).json({ status: "success", data: { id: Number(id) } });
}

const methods = { GET: list, PUT: update, DELETE: remove };

module.exports = async (req, res) => {
  const action = Object.hasOwn(methods, req.method) ? methods[req.method] : null;
  if (!action) {
    return res.status(405).json({ status: "error", message: "Use GET, PUT or DELETE." });
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
