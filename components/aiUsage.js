const { executeQuery } = require("./db");

// Count Gemini calls per day (table AI_USAGE, migration 004) for the admin
// site. Counters only: no note text, no user ids. Never fails the caller —
// a missing table (before the migration) or any DB error is only logged.
//   r: the suggestCategory() result, or the AiError it threw
async function recordUsage(connection, origin, r) {
  if (!r || !r.attempts) return; // never reached Gemini (e.g. NO_KEY)
  const outcome = r instanceof Error ? String(r.code || "ERROR").slice(0, 20) : "ok";
  try {
    await executeQuery(
      connection,
      `MERGE INTO ai_usage u
       USING (SELECT TRUNC(SYSDATE) AS day, :origin AS origin, :outcome AS outcome FROM dual) s
          ON (u.day = s.day AND u.origin = s.origin AND u.outcome = s.outcome)
        WHEN MATCHED THEN UPDATE SET calls = u.calls + 1, attempts = u.attempts + :attempts, ms_total = u.ms_total + :ms
        WHEN NOT MATCHED THEN INSERT (day, origin, outcome, calls, attempts, ms_total)
             VALUES (s.day, s.origin, s.outcome, 1, :attempts, :ms)`,
      { origin, outcome, attempts: r.attempts, ms: Math.round(r.ms || 0) }
    );
  } catch (e) {
    console.error("aiUsage:", e.message);
  }
}

// Usage for the admin overview: per day for the last `days` days.
// Returns null when the table does not exist yet.
async function usageSummary(connection, days = 30) {
  try {
    const r = await executeQuery(
      connection,
      `SELECT TO_CHAR(day, 'YYYY-MM-DD'), origin, outcome, calls, attempts, ms_total
         FROM ai_usage WHERE day >= TRUNC(SYSDATE) - :back ORDER BY day`,
      { back: days - 1 }
    );
    return r.rows.map((x) => ({ date: x[0], origin: x[1], outcome: x[2], calls: x[3], attempts: x[4], ms_total: x[5] }));
  } catch (e) {
    if (/ORA-00942/.test(e.message)) return null;
    throw e;
  }
}

module.exports = { recordUsage, usageSummary };
