const { getConnection, closeConnection } = require("../components/db");
const { resolveWallet } = require("../components/services");
const { lineAuth } = require("../components/lineAuth");
const rec = require("../components/recurring");

// Recurring records of the signed-in user (components/recurring.js).
//   GET    /api/me-recurring?wallet_id=      → { wallet_id, items: [...], limit }
//   POST   /api/me-recurring { wallet_id, exvalue, note, day, category?, notify? }   add
//   PUT    /api/me-recurring { id, exvalue?, note?, day?, category?, notify?, paused? }   edit
//   DELETE /api/me-recurring?id=
// Item: { id, exvalue, note, category, day, notify, paused, next_date }.
// Auth: LINE ID token.
const isId = (v) => /^\d{1,15}$/.test(String(v ?? ""));

function sendError(res, r) {
  if (r.error === "NOT_FOUND") return res.status(404).json({ status: "error", message: "Recurring item not found" });
  if (r.error === "LIMIT") {
    return res.status(400).json({ status: "error", code: "LIMIT", message: `A wallet can have at most ${r.limit} recurring items.` });
  }
  return res.status(400).json({ status: "error", message: r.error });
}

module.exports = async (req, res) => {
  if (!["GET", "POST", "PUT", "DELETE"].includes(req.method)) {
    return res.status(405).json({ status: "error", message: "Use GET, POST, PUT or DELETE." });
  }
  return lineAuth(req, res, async (uname) => {
    const body = req.body || {};
    let connection;
    try {
      connection = await getConnection();
      if (req.method === "GET" || req.method === "POST") {
        const wid = req.method === "GET" ? req.query.wallet_id : body.wallet_id;
        const wallet = await resolveWallet(connection, uname, wid === undefined || wid === null ? undefined : String(wid));
        if (!wallet) return res.status(404).json({ status: "error", message: "Wallet not found" });
        if (req.method === "GET") {
          const items = await rec.listItems(connection, uname, wallet);
          return res.status(200).json({ status: "success", data: { wallet_id: wallet.wallet_id, items, limit: rec.MAX_PER_WALLET } });
        }
        const r = await rec.createItem(connection, uname, wallet, body);
        if (r.error) return sendError(res, r);
        return res.status(200).json({ status: "success", data: r.item });
      }
      const id = req.method === "PUT" ? body.id : req.query.id;
      if (!isId(id)) return res.status(400).json({ status: "error", message: "Field 'id' is required." });
      if (req.method === "PUT") {
        const r = await rec.updateItem(connection, uname, Number(id), body);
        if (r.error) return sendError(res, r);
        return res.status(200).json({ status: "success", data: r.item });
      }
      if (!(await rec.deleteItem(connection, uname, Number(id)))) return sendError(res, { error: "NOT_FOUND" });
      return res.status(200).json({ status: "success", data: { id: Number(id) } });
    } catch (error) {
      console.error(`Error in /me-recurring ${req.method}:`, error.message);
      res.status(500).json({ status: "error", message: "Internal Server Error" });
    } finally {
      await closeConnection(connection);
    }
  });
};
