const { executeQuery, getConnection, closeConnection } = require("../components/db");
const { lineAuth } = require("../components/lineAuth");
const { setSummary } = require("../components/monthlySummary");
const { setNotify, REMIND_PAUSE_AFTER } = require("../components/notify");

// Notification switches of the signed-in user, for the web app's 🔔 dialog.
// The same USERS columns as the bot's commands ("เปิด/ปิดเตือนจด",
// "เปิด/ปิดสรุปรายสัปดาห์", "เปิด/ปิดสรุปรายเดือน"), so both stay in step.
//   GET /api/me-notify                → { remind, remind_paused, weekly, monthly }
//   PUT /api/me-notify { kind: "remind" | "weekly" | "monthly", on: true|false }
// remind_paused: the reminder is on but stopped after REMIND_PAUSE_AFTER
// reminders in a row with no record (it starts again with the next record;
// turning it off and on again also resets it). Settings are per user, not per wallet.
// Auth: LINE ID token. 404 when the user has no wallet yet.
const KINDS = ["remind", "weekly", "monthly"];

async function readSettings(connection, uname) {
  const r = await executeQuery(
    connection,
    `SELECT CASE WHEN u.remind_on IS NULL THEN 0 ELSE 1 END,
            CASE WHEN u.weekly_on IS NULL THEN 0 ELSE 1 END,
            CASE WHEN u.summary_off IS NULL THEN 1 ELSE 0 END,
            NVL(u.remind_streak, 0), u.remind_last
       FROM users u WHERE u.uname = :uname`,
    { uname }
  );
  if (!r.rows.length) return null;
  const [remind, weekly, monthly, streak, last] = r.rows[0];
  let paused = false;
  if (remind && streak >= REMIND_PAUSE_AFTER) {
    // the 21:00 run resets the streak only when it runs; a record typed since
    // the last reminder already means "not paused" (same rule as the run)
    const since = last ? await executeQuery(
      connection,
      `SELECT COUNT(*) FROM expense e JOIN wallet w ON w.uname = e.uname AND w.wallet_id = e.wallet_id AND w.deleted_at IS NULL
        WHERE e.uname = :uname AND e.recurring_id IS NULL AND e.fulldate >= TO_DATE(:last, 'YYYY-MM-DD')`,
      { uname, last }
    ) : { rows: [[0]] };
    paused = since.rows[0][0] === 0;
  }
  return { remind: !!remind, remind_paused: paused, weekly: !!weekly, monthly: !!monthly };
}

module.exports = async (req, res) => {
  if (!["GET", "PUT"].includes(req.method)) {
    return res.status(405).json({ status: "error", message: "Use GET or PUT." });
  }
  return lineAuth(req, res, async (uname) => {
    let connection;
    try {
      connection = await getConnection();
      if (req.method === "PUT") {
        const { kind, on } = req.body || {};
        if (!KINDS.includes(kind) || typeof on !== "boolean") {
          return res.status(400).json({ status: "error", message: "Fields 'kind' (remind|weekly|monthly) and 'on' (true/false) are required." });
        }
        const ok = kind === "monthly" ? await setSummary(connection, uname, on) : await setNotify(connection, uname, kind, on);
        if (!ok) return res.status(404).json({ status: "error", message: "User not found" });
      }
      const data = await readSettings(connection, uname);
      if (!data) return res.status(404).json({ status: "error", message: "User not found" });
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ status: "success", data });
    } catch (error) {
      console.error("Error in /me-notify:", error.message);
      res.status(500).json({ status: "error", message: "Internal Server Error" });
    } finally {
      await closeConnection(connection);
    }
  });
};
