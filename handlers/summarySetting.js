const { getConnection, closeConnection } = require("../components/db");
const apiKeyMiddleware = require("../apiKeyMiddleware");
const { setSummary } = require("../components/monthlySummary");
const { setNotify, markNoSpend } = require("../components/notify");

// POST /api/summarySetting — the bot's notification switches. 404 if the user has no wallet yet.
//   { uname, on: true|false }                          monthly summary ("เปิด/ปิดสรุปรายเดือน")
//   { uname, kind: "weekly" | "remind", on }           weekly summary / 21:00 reminder
//   { uname, kind: "nospend" }                         "วันนี้ไม่ได้ใช้เงิน": no reminder today
module.exports = async (req, res) => {
  apiKeyMiddleware(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({ status: "error", message: "Use POST." });
    }
    const { uname, on } = req.body || {};
    const kind = (req.body || {}).kind ?? "monthly";
    if (typeof uname !== "string" || !uname || uname.length > 150 || !["monthly", "weekly", "remind", "nospend"].includes(kind) ||
        (kind !== "nospend" && typeof on !== "boolean")) {
      return res.status(400).json({ status: "error", message: "Fields 'uname', 'kind' (monthly|weekly|remind|nospend) and 'on' (true/false) are required." });
    }
    let connection;
    try {
      connection = await getConnection();
      if (kind === "nospend") {
        const day = await markNoSpend(connection, uname);
        if (!day) return res.status(404).json({ status: "error", message: "User not found" });
        return res.status(200).json({ status: "success", data: { kind, day } });
      }
      const ok = kind === "monthly" ? await setSummary(connection, uname, on) : await setNotify(connection, uname, kind, on);
      if (!ok) {
        return res.status(404).json({ status: "error", message: "User not found" });
      }
      res.status(200).json({ status: "success", data: { kind, on } });
    } catch (error) {
      console.error("Error in /summarySetting:", error.message);
      res.status(500).json({ status: "error", message: "Internal Server Error" });
    } finally {
      await closeConnection(connection);
    }
  });
};
