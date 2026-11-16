const { getConnection, closeConnection } = require("../components/db");
const { resolveWallet } = require("../components/services");
const { lineAuth } = require("../components/lineAuth");
const { getBudgets, setBudget } = require("../components/budget");

// Monthly budgets per category for one wallet of the signed-in user.
//   GET /api/me-budget?wallet_id=&month=YYYY-MM  → { month, budgets: [{ key, icon, label, amount, spent, pct }] }
//   PUT /api/me-budget { wallet_id, category, amount }  (amount null or 0 removes it)
// Auth: LINE ID token.
module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "PUT") {
    return res.status(405).json({ status: "error", message: "Use GET or PUT." });
  }
  return lineAuth(req, res, async (uname) => {
    const src = req.method === "GET" ? req.query : req.body || {};
    const { wallet_id } = src;
    if (req.method === "PUT" && (wallet_id === undefined || wallet_id === "")) {
      return res.status(400).json({ status: "error", message: "Field 'wallet_id' is required." });
    }
    let connection;
    try {
      connection = await getConnection();
      const wallet = await resolveWallet(connection, uname, wallet_id);
      if (!wallet) return res.status(404).json({ status: "error", message: "Wallet not found" });

      if (req.method === "PUT") {
        const { category, amount } = src;
        const ok = await setBudget(connection, uname, wallet.wallet_id, category, amount === undefined ? NaN : amount);
        if (!ok) {
          return res.status(400).json({
            status: "error",
            message: "Field 'category' must be an expense category and 'amount' a number from 0 to 9,999,999.99 (null or 0 removes the budget).",
          });
        }
        return res.status(200).json({ status: "success", data: { wallet_id: wallet.wallet_id, category, amount: amount || null } });
      }

      const { month } = src;
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || "")) {
        return res.status(400).json({ status: "error", message: "Parameter 'month' must be in 'YYYY-MM' format." });
      }
      const budgets = await getBudgets(connection, uname, wallet.wallet_id, month);
      res.status(200).json({ status: "success", data: { wallet_id: wallet.wallet_id, month, budgets } });
    } catch (error) {
      console.error("Error in /me-budget:", error.message);
      res.status(500).json({ status: "error", message: "Internal Server Error" });
    } finally {
      await closeConnection(connection);
    }
  });
};
