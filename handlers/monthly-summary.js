const { getConnection, closeConnection } = require("../components/db");
const apiKeyMiddleware = require("../apiKeyMiddleware");
const { sendMonthlySummaries } = require("../components/monthlySummary");

// POST /api/monthly-summary — push last month's summary to every user (see
// components/monthlySummary.js). API key only; run on the 1st by
// scripts/monthly-summary.sh. Optional body:
//   month: "YYYY-MM" (default: last month, Thai time)
//   only: a uname (send to that user only), force: true (resend),
//   dry_run: true (build the messages, send nothing)
// Returns counts (and the messages with dry_run).
module.exports = async (req, res) => {
  apiKeyMiddleware(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({ status: "error", message: "Use POST." });
    }
    const { month, only, force, dry_run: dryRun } = req.body || {};
    if (month !== undefined && !(typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month))) {
      return res.status(400).json({ status: "error", message: "'month' must be 'YYYY-MM'." });
    }
    if (only !== undefined && !(typeof only === "string" && only && only.length <= 150)) {
      return res.status(400).json({ status: "error", message: "'only' must be a user id." });
    }
    let connection;
    try {
      connection = await getConnection();
      const data = await sendMonthlySummaries(connection, { month, only: only || null, force: force === true, dryRun: dryRun === true });
      res.status(200).json({ status: "success", data });
    } catch (error) {
      console.error("Error in /monthly-summary:", error.message);
      res.status(500).json({ status: "error", message: "Internal Server Error" });
    } finally {
      await closeConnection(connection);
    }
  });
};
