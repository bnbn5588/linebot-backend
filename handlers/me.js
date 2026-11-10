const { getConnection, closeConnection } = require("../components/db");
const { getWallets, resolveWallet } = require("../components/services");
const { lineAuth } = require("../components/lineAuth");
const { publicList } = require("../components/categories");

// GET /api/me — who is signed in, their current wallet and all their wallets.
// Auth: LINE ID token (Authorization: Bearer ...), not API_KEY.
module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ status: "error", message: "Use GET." });
  }
  return lineAuth(req, res, async (uname) => {
    let connection;
    try {
      connection = await getConnection();
      const current = await resolveWallet(connection, uname);
      if (!current) {
        // Signed in with LINE, but has never created a wallet through the bot
        return res.status(404).json({
          status: "error",
          code: "NO_WALLET",
          message: "No wallet yet. Create one in the chat: create [name] [timezone]",
        });
      }
      const wallets = (await getWallets(connection, uname)).map((row) => ({
        wallet_id: row[0],
        wallet_name: row[1],
        timezone: row[2],
      }));
      res.status(200).json({
        status: "success",
        data: { current_wallet: current, wallets, categories: publicList() },
      });
    } catch (error) {
      console.error("Error in /me:", error.message);
      res.status(500).json({ status: "error", message: "Internal Server Error" });
    } finally {
      await closeConnection(connection);
    }
  });
};
