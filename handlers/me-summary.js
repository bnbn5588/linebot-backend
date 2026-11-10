const {
  executeQuery,
  getConnection,
  closeConnection,
} = require("../components/db");
const { resolveWallet } = require("../components/services");
const { lineAuth } = require("../components/lineAuth");

// GET /api/me-summary?wallet_id=&month=YYYY-MM
// Dashboard data for one wallet of the signed-in user: overall totals, a row
// per month (income / expense / balance) and totals by note for `month`
// (all time when month is omitted).
module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ status: "error", message: "Use GET." });
  }
  return lineAuth(req, res, async (uname) => {
    const { wallet_id, month } = req.query;
    if (month !== undefined && month !== "" && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({
        status: "error",
        message: "Parameter 'month' must be in 'YYYY-MM' format.",
      });
    }

    let connection;
    try {
      connection = await getConnection();
      const wallet = await resolveWallet(connection, uname, wallet_id);
      if (!wallet) {
        return res.status(404).json({ status: "error", message: "Wallet not found" });
      }
      const binds = { uname, wallet_id: wallet.wallet_id };

      const totals = await executeQuery(
        connection,
        `SELECT sum(exvalue),
                sum(CASE WHEN exvalue > 0 THEN exvalue ELSE 0 END),
                sum(CASE WHEN exvalue < 0 THEN exvalue ELSE 0 END),
                count(*),
                TO_CHAR(min(fulldate), 'YYYY-MM-DD'),
                TO_CHAR(max(fulldate), 'YYYY-MM-DD')
           FROM expense
          WHERE uname = :uname AND wallet_id = :wallet_id`,
        binds
      );

      const months = await executeQuery(
        connection,
        `SELECT TO_CHAR(fulldate, 'YYYY-MM'),
                sum(CASE WHEN exvalue > 0 THEN exvalue ELSE 0 END),
                sum(CASE WHEN exvalue < 0 THEN exvalue ELSE 0 END),
                sum(exvalue),
                count(*)
           FROM expense
          WHERE uname = :uname AND wallet_id = :wallet_id
          GROUP BY TO_CHAR(fulldate, 'YYYY-MM')
          ORDER BY 1`,
        binds
      );

      const monthFilter = month
        ? "AND fulldate >= TO_DATE(:month, 'YYYY-MM') AND fulldate < ADD_MONTHS(TO_DATE(:month, 'YYYY-MM'), 1)"
        : "";
      const notes = await executeQuery(
        connection,
        `SELECT lower(note), sum(exvalue), count(*)
           FROM expense
          WHERE uname = :uname AND wallet_id = :wallet_id ${monthFilter}
          GROUP BY lower(note)
          ORDER BY 2`,
        month ? { ...binds, month } : binds
      );

      const t = totals.rows[0];
      res.status(200).json({
        status: "success",
        data: {
          wallet,
          totals: {
            balance: t[0] || 0,
            income: t[1] || 0,
            expense: t[2] || 0,
            count: t[3],
            first_date: t[4],
            last_date: t[5],
          },
          months: months.rows.map((r) => ({
            month: r[0],
            income: r[1],
            expense: r[2],
            balance: r[3],
            count: r[4],
          })),
          month: month || null,
          by_note: notes.rows.map((r) => ({ note: r[0], total: r[1], count: r[2] })),
        },
      });
    } catch (error) {
      console.error("Error in /me-summary:", error.message);
      res.status(500).json({ status: "error", message: "Internal Server Error" });
    } finally {
      await closeConnection(connection);
    }
  });
};
