const apiKeyMiddleware = require("../apiKeyMiddleware");
const { getConnection, closeConnection } = require("../components/db");
const { purgeExpired } = require("../components/walletAdmin");

// POST /api/purge-wallets — delete for good every wallet that has been in the
// trash for 30 days (its records and budgets too). API key only; run once a
// day by scripts/purge-wallets.sh. Returns counts only.
module.exports = async (req, res) => {
  apiKeyMiddleware(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({ status: "error", message: "Use POST." });
    }
    let connection;
    try {
      connection = await getConnection();
      const data = await purgeExpired(connection);
      res.status(200).json({ status: "success", data });
    } catch (error) {
      console.error("Error in /purge-wallets:", error.message);
      res.status(500).json({ status: "error", message: "Internal Server Error" });
    } finally {
      await closeConnection(connection);
    }
  });
};
