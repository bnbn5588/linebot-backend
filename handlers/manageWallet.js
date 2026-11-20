const { getConnection, closeConnection } = require("../components/db");
const apiKeyMiddleware = require("../apiKeyMiddleware");
const { getWallet } = require("../components/services");
const { isTextWithin } = require("../components/utilities");
const { cleanName, walletStats, renameWallet, deleteWallet } = require("../components/walletAdmin");

// Bot wallet management (API key; uname = LINE userId from the signed event).
//   POST /api/manageWallet { uname, action: "rename", wallet_name }            rename the current wallet
//   POST /api/manageWallet { uname, action: "info", wallet_id? }               name + record count (for the confirm card)
//   POST /api/manageWallet { uname, action: "delete", wallet_id, wallet_name } delete (name must still match)
module.exports = async (req, res) => {
  apiKeyMiddleware(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({ status: "error", message: "Use POST." });
    }
    const { uname, action, wallet_id, wallet_name } = req.body || {};
    const bad = (message) => res.status(400).json({ status: "error", message });
    if (!isTextWithin(uname, 150)) return bad("Field 'uname' is required.");
    if (!["rename", "info", "delete"].includes(action)) return bad("Field 'action' must be rename, info or delete.");
    if (wallet_id !== undefined && wallet_id !== null && !/^\d{1,9}$/.test(String(wallet_id))) {
      return bad("Field 'wallet_id' must be a non-negative integer.");
    }
    let connection;
    try {
      connection = await getConnection();
      let id = wallet_id === undefined || wallet_id === null ? null : Number(wallet_id);
      if (id === null) {
        const cur = await getWallet(connection, uname);
        if (!cur) return res.status(404).json({ status: "error", code: "NO_WALLET", message: "No wallet yet." });
        id = cur[0][0];
      }

      if (action === "rename") {
        const name = cleanName(wallet_name);
        if (!name) return bad("Field 'wallet_name' is required (max 150 bytes).");
        const r = await renameWallet(connection, uname, id, name);
        if (!r) return res.status(404).json({ status: "error", message: "Wallet not found" });
        return res.status(200).json({ status: "success", data: r });
      }

      if (action === "info") {
        const all = await walletStats(connection, uname);
        const w = all.find((x) => x.wallet_id === id);
        if (!w) return res.status(404).json({ status: "error", message: "Wallet not found" });
        return res.status(200).json({ status: "success", data: { ...w, wallets: all.length } });
      }

      if (typeof wallet_name !== "string" || wallet_id === undefined || wallet_id === null) {
        return bad("Fields 'wallet_id' and 'wallet_name' are required to delete.");
      }
      const r = await deleteWallet(connection, uname, id, wallet_name);
      if (r.error === "NOT_FOUND" || r.error === "NAME_MISMATCH") {
        return res.status(404).json({ status: "error", code: r.error, message: "Wallet not found" });
      }
      if (r.error === "LAST_WALLET") {
        return res.status(409).json({ status: "error", code: r.error, message: "Cannot delete the only wallet." });
      }
      return res.status(200).json({ status: "success", data: r });
    } catch (error) {
      console.error("Error in /manageWallet:", error.message);
      res.status(500).json({ status: "error", message: "Internal Server Error" });
    } finally {
      await closeConnection(connection);
    }
  });
};
