const {
  executeQuery,
  getConnection,
  closeConnection,
} = require("../components/db");
const { lineAuth } = require("../components/lineAuth");
const { NOTE_KEY_SQL, CATEGORIES, describe, remember } = require("../components/categories");

// /api/me-memory — the notes whose category the signed-in user has taught.
//   GET                                   list (with how many records use each note)
//   PUT    body { note_key, category }    change the remembered category
//   DELETE ?note_key=                     forget it (back to keyword guessing)
// Scoped by the verified LINE userId. Records already saved keep their
// category; only future records with that note are affected.
const KIND = new Map(CATEGORIES.map((c) => [c.key, c.kind]));

function bad(res, message) {
  return res.status(400).json({ status: "error", message });
}
const validKey = (k) => typeof k === "string" && k.trim() !== "" && Buffer.byteLength(k, "utf8") <= 250;

async function list(req, res, connection, uname) {
  const r = await executeQuery(
    connection,
    `SELECT m.note_key, m.category, TO_CHAR(m.updated_at, 'YYYY-MM-DD'), NVL(e.cnt, 0)
       FROM category_memory m
       LEFT JOIN (SELECT ${NOTE_KEY_SQL} AS note_key, count(*) AS cnt
                    FROM expense WHERE uname = :uname
                   GROUP BY ${NOTE_KEY_SQL}) e
         ON e.note_key = m.note_key
      WHERE m.uname = :uname
      ORDER BY m.updated_at DESC, m.note_key`,
    { uname }
  );
  res.status(200).json({
    status: "success",
    data: r.rows.map(([note_key, category, updated, count]) => ({
      note_key,
      category: describe(category, KIND.get(category) === "income" ? 1 : -1),
      updated_at: updated,
      records: count,
    })),
  });
}

async function update(req, res, connection, uname) {
  const { note_key, category } = req.body || {};
  if (!validKey(note_key)) return bad(res, "Field 'note_key' is required.");
  const current = await executeQuery(
    connection,
    "SELECT category FROM category_memory WHERE uname = :uname AND note_key = :note_key",
    { uname, note_key }
  );
  if (!current.rows.length) {
    return res.status(404).json({ status: "error", message: "Not found" });
  }
  // Keep the same kind (expense/income) as what was remembered
  if (typeof category !== "string" || KIND.get(category) !== KIND.get(current.rows[0][0])) {
    return bad(res, "Field 'category' must be a category of the same kind.");
  }
  await remember(connection, uname, note_key, category); // "other" = forget
  res.status(200).json({ status: "success", data: { note_key, category: describe(category, KIND.get(category) === "income" ? 1 : -1) } });
}

async function remove(req, res, connection, uname) {
  const note_key = req.query.note_key;
  if (!validKey(note_key)) return bad(res, "Parameter 'note_key' is required.");
  const r = await executeQuery(
    connection,
    "DELETE FROM category_memory WHERE uname = :uname AND note_key = :note_key",
    { uname, note_key }
  );
  if (!r.rowsAffected) {
    return res.status(404).json({ status: "error", message: "Not found" });
  }
  res.status(200).json({ status: "success", data: { note_key } });
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
      console.error(`Error in /me-memory ${req.method}:`, error.message);
      res.status(500).json({ status: "error", message: "Internal Server Error" });
    } finally {
      await closeConnection(connection);
    }
  });
};
