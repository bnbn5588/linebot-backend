const { executeQuery, getConnection, closeConnection } = require("../components/db");
const { resolveWallet } = require("../components/services");
const { lineAuth } = require("../components/lineAuth");

// GET /api/me-notes?wallet_id=
// Every note of one wallet of the signed-in user, from all months, for the
// "เลือกโน้ต" picker: most used first. The key is the same as the by-note
// list and the `note` filter of me-transactions / me-summary
// (lower-case, trimmed). Also used for the note suggestions under the
// "โน้ต" field of the record and recurring editors.
// When the wallet has more notes than MAX_NOTES (truncated: true), the app
// searches the rest with ?q= (spaces and case ignored, like the app's own
// filter; notes that start with it first, then most used), optional
// kind=income|expense (sign of the newest record) and limit (1..300, default 50).
const MAX_NOTES = 1000;
const MAX_Q = 100;

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ status: "error", message: "Use GET." });
  }
  return lineAuth(req, res, async (uname) => {
    let connection;
    try {
      connection = await getConnection();
      const wallet = await resolveWallet(connection, uname, req.query.wallet_id);
      if (!wallet) {
        return res.status(404).json({ status: "error", message: "Wallet not found" });
      }
      const { q, kind, limit } = req.query;
      const search = q !== undefined;
      if (search && (typeof q !== "string" || q.length > MAX_Q || (kind !== undefined && !["income", "expense"].includes(kind)) ||
          (limit !== undefined && !(/^\d{1,3}$/.test(String(limit)) && limit >= 1 && limit <= 300)))) {
        return res.status(400).json({ status: "error", message: `'q' (up to ${MAX_Q} characters), optional 'kind' (income|expense) and 'limit' (1-300).` });
      }
      // same as the app's normNote: lower case, no white space
      const needle = search ? q.toLowerCase().replace(/\s+/g, "") : "";
      if (search && !needle) {
        return res.status(400).json({ status: "error", message: "'q' must not be empty." });
      }
      const max = search ? Number(limit || 50) : MAX_NOTES;
      const LAST = "KEEP (DENSE_RANK LAST ORDER BY fulldate, trans_id)";
      const NORM = "REGEXP_REPLACE(lower(trim(note)), '[[:space:]]', '')";
      const like = needle.replace(/[\\%_]/g, (c) => "\\" + c);
      const binds = { uname, wallet_id: wallet.wallet_id };
      if (search) Object.assign(binds, { has: `%${like}%`, starts: `${like}%` });
      const r = await executeQuery(
        connection,
        `SELECT lower(trim(note)), count(*), sum(exvalue), TO_CHAR(max(fulldate), 'YYYY-MM-DD'),
                max(trim(note)) ${LAST}, max(category) ${LAST}, max(exvalue) ${LAST}
           FROM expense
          WHERE uname = :uname AND wallet_id = :wallet_id AND trim(note) IS NOT NULL
                ${search ? `AND ${NORM} LIKE :has ESCAPE '\\'` : ""}
          GROUP BY lower(trim(note))
          ${search && kind ? `HAVING max(exvalue) ${LAST} ${kind === "income" ? "> 0" : "<= 0"}` : ""}
          ORDER BY ${search ? `CASE WHEN ${NORM} LIKE :starts ESCAPE '\\' THEN 0 ELSE 1 END, ` : ""}2 DESC, 4 DESC, 1
          FETCH FIRST ${max + 1} ROWS ONLY`,
        binds
      );
      const rows = r.rows.slice(0, max);
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({
        status: "success",
        data: {
          // text / last_category / last_value: the newest record with that note
          // (as typed, its category or null, its amount) for the note suggestions
          notes: rows.map(([note, count, total, last, text, lastCategory, lastValue]) => ({
            note, count, total, last, text, last_category: lastCategory, last_value: lastValue,
          })),
          truncated: r.rows.length > max,
        },
      });
    } catch (error) {
      console.error("Error in /me-notes:", error.message);
      res.status(500).json({ status: "error", message: "Internal Server Error" });
    } finally {
      await closeConnection(connection);
    }
  });
};
