const { getConnection, closeConnection } = require("../components/db");
const { lineAuth } = require("../components/lineAuth");
const { cleanName, walletStats, renameWallet, deleteWallet } = require("../components/walletAdmin");

// /api/me-wallets — the signed-in user's wallets (LINE ID token).
//   GET                                   [{ wallet_id, wallet_name, timezone, records, balance, current }]
//   PUT    { wallet_id, wallet_name }      rename
//   DELETE ?wallet_id=&name=               delete wallet + its records + budgets (name must match)
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
        return res.status(200).json({ status: "success", data: await walletStats(connection, uname) });
      }
      const id = Number(src.wallet_id);
      if (req.method === "PUT") {
        const name = cleanName(src.wallet_name);
        if (!name) return bad("Field 'wallet_name' is required (max 150 bytes).");
        const r = await renameWallet(connection, uname, id, name);
        if (!r) return res.status(404).json({ status: "error", message: "Wallet not found" });
        return res.status(200).json({ status: "success", data: r });
      }
      if (typeof src.name !== "string" || !src.name.trim()) return bad("Parameter 'name' (the wallet's name) is required.");
      const r = await deleteWallet(connection, uname, id, src.name);
      if (r.error === "NOT_FOUND") return res.status(404).json({ status: "error", code: r.error, message: "Wallet not found" });
      if (r.error === "NAME_MISMATCH") return res.status(400).json({ status: "error", code: r.error, message: "The name does not match the wallet." });
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
