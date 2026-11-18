const { executeQuery, getConnection, closeConnection } = require("../components/db");
const { resolveWallet } = require("../components/services");
const { lineAuth } = require("../components/lineAuth");

// GET /api/me-notes?wallet_id=
// Every note of one wallet of the signed-in user, from all months, for the
// "เลือกโน้ต" picker: most used first. The key is the same as the by-note
// list and the `note` filter of me-transactions / me-summary
// (lower-case, trimmed).
const MAX_NOTES = 1000;

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
      const r = await executeQuery(
        connection,
        `SELECT lower(trim(note)), count(*), sum(exvalue), TO_CHAR(max(fulldate), 'YYYY-MM-DD')
           FROM expense
          WHERE uname = :uname AND wallet_id = :wallet_id AND trim(note) IS NOT NULL
          GROUP BY lower(trim(note))
          ORDER BY 2 DESC, 4 DESC, 1
          FETCH FIRST ${MAX_NOTES + 1} ROWS ONLY`,
        { uname, wallet_id: wallet.wallet_id }
      );
      const rows = r.rows.slice(0, MAX_NOTES);
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({
        status: "success",
        data: {
          notes: rows.map(([note, count, total, last]) => ({ note, count, total, last })),
          truncated: r.rows.length > MAX_NOTES,
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
