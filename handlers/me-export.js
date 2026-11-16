const { executeQuery, getConnection, closeConnection } = require("../components/db");
const { resolveWallet } = require("../components/services");
const { lineAuth } = require("../components/lineAuth");
const { describe } = require("../components/categories");

// GET /api/me-export?wallet_id=&month=YYYY-MM — the signed-in user's records
// for one wallet and month as CSV (UTF-8 with BOM so Excel reads Thai).
// Scoped by uname from the verified LINE token. Times are the stored wallet
// time (fulldate), the same as the web page shows.

const MAX_ROWS = 5000;

function cell(value, text = true) {
  let s = value === null || value === undefined ? "" : String(value);
  // Spreadsheet formula injection: a note like "=HYPERLINK(...)" must stay text
  // (not for the amount column, which is a number we produce, e.g. -120)
  if (text && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function amount(n) {
  return String(Math.round(Number(n) * 100) / 100);
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ status: "error", message: "Use GET." });
  }
  return lineAuth(req, res, async (uname) => {
    const { wallet_id, month } = req.query;
    if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({ status: "error", message: "Parameter 'month' must be in 'YYYY-MM' format." });
    }
    let connection;
    try {
      connection = await getConnection();
      const wallet = await resolveWallet(connection, uname, wallet_id);
      if (!wallet) {
        return res.status(404).json({ status: "error", message: "Wallet not found" });
      }
      const result = await executeQuery(
        connection,
        `SELECT TO_CHAR(fulldate, 'YYYY-MM-DD HH24:MI:SS'), exvalue, category, note
           FROM expense
          WHERE uname = :uname AND wallet_id = :wallet_id
            AND fulldate >= TO_DATE(:month, 'YYYY-MM') AND fulldate < ADD_MONTHS(TO_DATE(:month, 'YYYY-MM'), 1)
          ORDER BY fulldate ASC, trans_id ASC
          FETCH FIRST :fetch ROWS ONLY`,
        { uname, wallet_id: wallet.wallet_id, month, fetch: MAX_ROWS + 1 }
      );
      if (result.rows.length > MAX_ROWS) {
        return res.status(413).json({ status: "error", message: `เดือนนี้มีรายการเกิน ${MAX_ROWS} รายการ` });
      }
      const lines = [["วันที่-เวลา", "ประเภท", "หมวด", "จำนวนเงิน", "โน้ต"].join(",")];
      for (const [datetime, exvalue, category, note] of result.rows) {
        lines.push([
          datetime,
          exvalue > 0 ? "รายรับ" : "รายจ่าย",
          describe(category, exvalue).label,
          amount(exvalue),
          note,
        ].map((v, i) => cell(v, i !== 3)).join(","));
      }
      const filename = `expenses-${wallet.wallet_id}-${month}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Row-Count", String(result.rows.length));
      return res.status(200).send("\uFEFF" + lines.join("\r\n") + "\r\n");
    } catch (error) {
      console.error("Error in /me-export:", error.message);
      return res.status(500).json({ status: "error", message: "Internal Server Error" });
    } finally {
      await closeConnection(connection);
    }
  });
};
