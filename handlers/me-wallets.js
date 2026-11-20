const { getConnection, closeConnection } = require("../components/db");
const { lineAuth } = require("../components/lineAuth");
const { cleanName, walletStats, renameWallet, trashWallet, restoreWallet, TRASH_DAYS } = require("../components/walletAdmin");

// /api/me-wallets — the signed-in user's wallets (LINE ID token).
//   GET                                  { wallets: [...], trash: [... purge_on, days_left], trash_days }
//   PUT    { wallet_id, wallet_name }     rename
//   PUT    { wallet_id, restore: true }   take a wallet out of the trash
//   DELETE ?wallet_id=                   move to the trash (restorable for trash_days days)
module.exports = async (req, res) => {
  if (!["GET", "PUT", "DELETE"].includes(req.method)) {
    return res.status(405).json({ status: "error", message: "Use GET, PUT or DELETE." });
  }
  return lineAuth(req, res, async (uname) => {
    const bad = (message) => res.status(400).json({ status: "error", message });
    const src = req.method === "PUT" ? req.body || {} : req.query;
    if (req.method !== "GET" && !/^\d{1,9}$/.test(String(src.wallet_id ?? ""))) {
      return bad("Field 'wallet_id' must be a non-negative integer.");
    }
    let connection;
    try {
      connection = await getConnection();
      if (req.method === "GET") {
        const s = await walletStats(connection, uname);
        return res.status(200).json({ status: "success", data: { ...s, trash_days: TRASH_DAYS } });
      }
      const id = Number(src.wallet_id);
      if (req.method === "PUT" && src.restore === true) {
        const r = await restoreWallet(connection, uname, id);
        if (!r) return res.status(404).json({ status: "error", message: "Wallet not found in the trash" });
        return res.status(200).json({ status: "success", data: r });
      }
      if (req.method === "PUT") {
        const name = cleanName(src.wallet_name);
        if (!name) return bad("Field 'wallet_name' is required (max 150 bytes).");
        const r = await renameWallet(connection, uname, id, name);
        if (!r) return res.status(404).json({ status: "error", message: "Wallet not found" });
        return res.status(200).json({ status: "success", data: r });
      }
      const r = await trashWallet(connection, uname, id);
      if (r.error === "NOT_FOUND") return res.status(404).json({ status: "error", code: r.error, message: "Wallet not found" });
      if (r.error === "LAST_WALLET") return res.status(409).json({ status: "error", code: r.error, message: "Cannot delete the only wallet." });
      return res.status(200).json({ status: "success", data: r });
    } catch (error) {
      console.error(`Error in /me-wallets ${req.method}:`, error.message);
      res.status(500).json({ status: "error", message: "Internal Server Error" });
    } finally {
      await closeConnection(connection);
    }
  });
};
