const { getConnection, closeConnection } = require("../components/db");
const apiKeyMiddleware = require("../apiKeyMiddleware");
const { getWallet } = require("../components/services");
const { isTextWithin } = require("../components/utilities");
const { cleanName, walletStats, renameWallet, trashWallet, restoreWallet, TRASH_DAYS } = require("../components/walletAdmin");

// Bot wallet management (API key; uname = LINE userId from the signed event).
//   POST /api/manageWallet { uname, action: "rename", wallet_name }            rename the current wallet
//   POST /api/manageWallet { uname, action: "info", wallet_id? }               name + record count (confirm card)
//   POST /api/manageWallet { uname, action: "delete", wallet_id, wallet_name } move to the trash (name must still match)
//   POST /api/manageWallet { uname, action: "trash" }                          wallets in the trash
//   POST /api/manageWallet { uname, action: "restore", wallet_id }             take one out of the trash
module.exports = async (req, res) => {
  apiKeyMiddleware(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({ status: "error", message: "Use POST." });
    }
    const { uname, action, wallet_id, wallet_name } = req.body || {};
    const bad = (message) => res.status(400).json({ status: "error", message });
    const notFound = (code) => res.status(404).json({ status: "error", ...(code ? { code } : {}), message: "Wallet not found" });
    if (!isTextWithin(uname, 150)) return bad("Field 'uname' is required.");
    if (!["rename", "info", "delete", "trash", "restore"].includes(action)) {
      return bad("Field 'action' must be rename, info, delete, trash or restore.");
    }
    const hasId = wallet_id !== undefined && wallet_id !== null;
    if (hasId && !/^\d{1,9}$/.test(String(wallet_id))) return bad("Field 'wallet_id' must be a non-negative integer.");
    if ((action === "delete" || action === "restore") && !hasId) return bad("Field 'wallet_id' is required.");
    if (action === "delete" && typeof wallet_name !== "string") return bad("Field 'wallet_name' is required to delete.");
    let connection;
    try {
      connection = await getConnection();
      if (action === "trash") {
        const { trash } = await walletStats(connection, uname);
        return res.status(200).json({ status: "success", data: { trash, trash_days: TRASH_DAYS } });
      }
      if (action === "restore") {
        const r = await restoreWallet(connection, uname, Number(wallet_id));
        if (!r) return notFound();
        return res.status(200).json({ status: "success", data: r });
      }

      let id = hasId ? Number(wallet_id) : null;
      if (id === null) {
        const cur = await getWallet(connection, uname);
        if (!cur) return res.status(404).json({ status: "error", code: "NO_WALLET", message: "No wallet yet." });
        id = cur[0][0];
      }

      if (action === "rename") {
        const name = cleanName(wallet_name);
        if (!name) return bad("Field 'wallet_name' is required (max 150 bytes).");
        const r = await renameWallet(connection, uname, id, name);
        if (!r) return notFound();
        return res.status(200).json({ status: "success", data: r });
      }

      if (action === "info") {
        const { wallets, trash } = await walletStats(connection, uname);
        const w = wallets.find((x) => x.wallet_id === id);
        if (!w) return notFound();
        return res.status(200).json({ status: "success", data: { ...w, wallets: wallets.length, in_trash: trash.length, trash_days: TRASH_DAYS } });
      }

      const r = await trashWallet(connection, uname, id, wallet_name);
      if (r.error === "NOT_FOUND" || r.error === "NAME_MISMATCH") return notFound(r.error);
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
