const {
  executeQuery,
  getConnection,
  closeConnection,
} = require("../components/db");
const apiKeyMiddleware = require("../apiKeyMiddleware");
const { remember, describe, isValidFor, forgetIfUnused } = require("../components/categories");
const { isTextWithin } = require("../components/utilities");

// Bot actions on a single record, triggered by buttons on the chat card.
//   POST /api/setCategory  { uname, id, category }
//   POST /api/deleteRecord { uname, id }
// Both only touch a record that belongs to `uname` (the LINE userId of the
// person who pressed the button, taken from the signed webhook event).
// Unknown or someone else's record -> 404, so stale buttons fail safely.

function bad(res, message) {
  return res.status(400).json({ status: "error", message });
}

async function findRecord(connection, uname, id) {
  const r = await executeQuery(
    connection,
    "SELECT trans_id, exvalue, note, category, TO_CHAR(fulldate, 'YYYY-MM-DD HH24:MI') FROM expense WHERE trans_id = :id AND uname = :uname",
    { id, uname }
  );
  const row = r.rows[0];
  return row ? { id: row[0], exvalue: row[1], note: row[2], category: row[3], datetime: row[4] } : null;
}

function handler(action) {
  return async (req, res) => {
    apiKeyMiddleware(req, res, async () => {
      if (req.method !== "POST") {
        return res.status(405).json({ status: "error", message: "Use POST." });
      }
      const { uname, id, category } = req.body || {};
      if (!isTextWithin(uname, 150) || !/^\d{1,15}$/.test(String(id ?? ""))) {
        return bad(res, "Fields 'uname' and 'id' are required.");
      }
      if (action === "setCategory" && typeof category !== "string") {
        return bad(res, "Field 'category' is required.");
      }

      let connection;
      try {
        connection = await getConnection();
        const rec = await findRecord(connection, uname, Number(id));
        if (!rec) {
          return res.status(404).json({ status: "error", message: "Record not found" });
        }

        if (action === "setCategory") {
          if (!isValidFor(category, rec.exvalue)) {
            return bad(res, "This category does not fit this record.");
          }
          await executeQuery(
            connection,
            "UPDATE expense SET category = :category WHERE trans_id = :id AND uname = :uname",
            { category, id: rec.id, uname }
          );
          await remember(connection, uname, rec.note, category);
          return res.status(200).json({
            status: "success",
            data: { id: rec.id, exvalue: rec.exvalue, note: rec.note, category: describe(category, rec.exvalue) },
          });
        }

        await executeQuery(
          connection,
          "DELETE FROM expense WHERE trans_id = :id AND uname = :uname",
          { id: rec.id, uname }
        );
        const forgot = await forgetIfUnused(connection, uname, rec.note);
        return res.status(200).json({
          status: "success",
          data: { id: rec.id, exvalue: rec.exvalue, note: rec.note, datetime: rec.datetime, category: describe(rec.category, rec.exvalue), memory_forgotten: forgot },
        });
      } catch (error) {
        console.error(`Error in /${action}:`, error.message);
        res.status(500).json({ status: "error", message: "Internal Server Error" });
      } finally {
        await closeConnection(connection);
      }
    });
  };
}

module.exports = { setCategory: handler("setCategory"), deleteRecord: handler("deleteRecord") };
