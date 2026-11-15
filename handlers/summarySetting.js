const { getConnection, closeConnection } = require("../components/db");
const apiKeyMiddleware = require("../apiKeyMiddleware");
const { setSummary } = require("../components/monthlySummary");

// POST /api/summarySetting  { uname, on: true|false } — the bot's
// "เปิดสรุปรายเดือน" / "ปิดสรุปรายเดือน". 404 if the user has no wallet yet.
module.exports = async (req, res) => {
  apiKeyMiddleware(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({ status: "error", message: "Use POST." });
    }
    const { uname, on } = req.body || {};
    if (typeof uname !== "string" || !uname || uname.length > 150 || typeof on !== "boolean") {
      return res.status(400).json({ status: "error", message: "Fields 'uname' and 'on' (true/false) are required." });
    }
    let connection;
    try {
      connection = await getConnection();
      if (!(await setSummary(connection, uname, on))) {
        return res.status(404).json({ status: "error", message: "User not found" });
      }
      res.status(200).json({ status: "success", data: { on } });
    } catch (error) {
      console.error("Error in /summarySetting:", error.message);
      res.status(500).json({ status: "error", message: "Internal Server Error" });
    } finally {
      await closeConnection(connection);
    }
  });
};
