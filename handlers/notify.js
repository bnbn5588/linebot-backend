const { getConnection, closeConnection } = require("../components/db");
const apiKeyMiddleware = require("../apiKeyMiddleware");
const { sendReminders, sendWeeklySummaries } = require("../components/notify");

// POST /api/notify { job: "remind" | "weekly" } — opt-in pushes (components/notify.js).
// API key only; run by scripts/notify.sh from cron:
//   remind: daily 21:00 Thai time; weekly: Mondays 09:00 Thai time.
// Optional: only (one uname), dry_run: true (build, send nothing), force (weekly: resend).
// Returns counts (and the messages with dry_run).
module.exports = async (req, res) => {
  apiKeyMiddleware(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({ status: "error", message: "Use POST." });
    }
    const { job, only, dry_run: dryRun, force } = req.body || {};
    if (job !== "remind" && job !== "weekly") {
      return res.status(400).json({ status: "error", message: "'job' must be 'remind' or 'weekly'." });
    }
    if (only !== undefined && !(typeof only === "string" && only && only.length <= 150)) {
      return res.status(400).json({ status: "error", message: "'only' must be a user id." });
    }
    let connection;
    try {
      connection = await getConnection();
      const opts = { only: only || null, dryRun: dryRun === true, force: force === true };
      const data = job === "remind" ? await sendReminders(connection, opts) : await sendWeeklySummaries(connection, opts);
      res.status(200).json({ status: "success", data });
    } catch (error) {
      console.error("Error in /notify:", error.message);
      res.status(500).json({ status: "error", message: "Internal Server Error" });
    } finally {
      await closeConnection(connection);
    }
  });
};
