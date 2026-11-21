const { getConnection, closeConnection } = require("../components/db");
const apiKeyMiddleware = require("../apiKeyMiddleware");
const { resolveWallet } = require("../components/services");
const rec = require("../components/recurring");

// POST /api/recurring — API key (bot and cron), components/recurring.js.
//   { action: "list", uname }            items of the current wallet (bot "ประจำ")
//   { action: "undo", uname, id }        delete a record the daily run made (bot button)
//   { action: "run", only?, dry_run? }   record everything due (cron 07:00 Thai time)
module.exports = async (req, res) => {
  apiKeyMiddleware(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({ status: "error", message: "Use POST." });
    }
    const { action, uname, id, only, dry_run: dryRun } = req.body || {};
    if (!["list", "undo", "run"].includes(action)) {
      return res.status(400).json({ status: "error", message: "'action' must be 'list', 'undo' or 'run'." });
    }
    const isUser = (u) => typeof u === "string" && u && u.length <= 150;
    if (action !== "run" && !isUser(uname)) {
      return res.status(400).json({ status: "error", message: "'uname' is required." });
    }
    if (action === "undo" && !/^\d{1,15}$/.test(String(id ?? ""))) {
      return res.status(400).json({ status: "error", message: "'id' is required." });
    }
    if (action === "run" && only !== undefined && !isUser(only)) {
      return res.status(400).json({ status: "error", message: "'only' must be a user id." });
    }
    let connection;
    try {
      connection = await getConnection();
      if (action === "list") {
        const wallet = await resolveWallet(connection, uname);
        if (!wallet) return res.status(404).json({ status: "error", message: "Wallet not found" });
        const items = await rec.listItems(connection, uname, wallet);
        return res.status(200).json({ status: "success", data: { wallet, items } });
      }
      if (action === "undo") {
        const r = await rec.undoRecord(connection, uname, Number(id));
        if (!r) return res.status(404).json({ status: "error", message: "Record not found" });
        return res.status(200).json({ status: "success", data: r });
      }
      const data = await rec.runDue(connection, { only: only || null, dryRun: dryRun === true });
      res.status(200).json({ status: "success", data });
    } catch (error) {
      console.error("Error in /recurring:", error.message);
      res.status(500).json({ status: "error", message: "Internal Server Error" });
    } finally {
      await closeConnection(connection);
    }
  });
};
