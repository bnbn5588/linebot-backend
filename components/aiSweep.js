const { executeQuery, getConnection, closeConnection } = require("./db");
const { NOTE_KEY_SQL, AI_MIN_CONFIDENCE } = require("./categories");
const ai = require("./ai");
const { TH_TODAY_START_UTC } = require("./thaiTime");
const { recordUsage } = require("./aiUsage");
const { DAILY_CAP } = require("./aiFill");

// Daily catch-up for the automatic AI fill (components/aiFill.js). When
// Gemini failed at the time a record was saved (timeout, busy, quota, the
// daily cap), nothing was stored and the record stayed "other". This asks
// again, once per note, for records of the last `days` days that are still
// "other" and whose note has no row in the shared table yet.
// Same rules as aiFill: only the note text and expense/income are sent; the
// answer goes into CATEGORY_MAP (source 'ai', updated_by 'auto'); with
// confidence >= AI_MIN_CONFIDENCE those records get the category. A Gemini
// error stores nothing (tried again tomorrow); QUOTA stops the run.
// Run by scripts/ai-sweep.sh (server cron) through POST /api/ai-sweep.

async function withConnection(fn) {
  let connection;
  try {
    connection = await getConnection();
    return await fn(connection);
  } finally {
    await closeConnection(connection);
  }
}

const KIND_SQL = "CASE WHEN exvalue > 0 THEN 'income' ELSE 'expense' END";
const FALLBACK = { expense: "other_expense", income: "other_income" };

async function candidates(connection, days, max) {
  const r = await executeQuery(
    connection,
    `SELECT note_key, kind, count(*) FROM (
       SELECT ${NOTE_KEY_SQL} AS note_key, ${KIND_SQL} AS kind, fulldate
         FROM expense
        WHERE category IN ('other_expense', 'other_income')
          AND fulldate >= TRUNC(SYSDATE) - :days
     ) e
      WHERE note_key IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM category_map m WHERE m.note_key = e.note_key AND m.kind = e.kind)
      GROUP BY note_key, kind
      ORDER BY max(fulldate) DESC
      FETCH FIRST :max ROWS ONLY`,
    { days, max }
  );
  return r.rows.map(([note_key, kind, records]) => ({ note_key, kind, records }));
}

async function capLeft(connection) {
  const r = await executeQuery(
    connection,
    `SELECT count(*) FROM category_map WHERE updated_by IN ('auto', 'disputed') AND updated_at >= ${TH_TODAY_START_UTC}`,
    []
  );
  return Math.max(0, DAILY_CAP - r.rows[0][0]);
}

// Returns a summary with counts only (no notes), e.g. for the cron log.
async function aiSweep({ days = 7, max = 20, budgetMs = 45000 } = {}) {
  const started = Date.now();
  const out = { candidates: 0, asked: 0, saved: 0, confident: 0, records_updated: 0, errors: {}, stopped: null };
  if (!ai.enabled()) return { ...out, stopped: "NO_KEY" };

  const { list, left } = await withConnection(async (c) => ({ list: await candidates(c, days, max), left: await capLeft(c) }));
  out.candidates = list.length;

  for (const item of list) {
    if (out.asked >= left) { out.stopped = "CAP"; break; }
    const remaining = budgetMs - (Date.now() - started);
    if (remaining < 8000) { out.stopped = "TIME"; break; } // the function has maxDuration 60 s

    out.asked++;
    let s;
    try {
      s = await ai.suggestCategory(item.note_key, item.kind, { budgetMs: Math.min(20000, remaining - 3000) });
    } catch (e) {
      if (!(e instanceof ai.AiError)) throw e;
      out.errors[e.code] = (out.errors[e.code] || 0) + 1;
      await withConnection((c) => recordUsage(c, "auto", e));
      if (e.code === "QUOTA") { out.stopped = "QUOTA"; break; }
      continue;
    }

    await withConnection(async (c) => {
      await recordUsage(c, "auto", s);
      const m = await executeQuery(
        c,
        `MERGE INTO category_map m
         USING (SELECT :note_key AS note_key, :kind AS kind FROM dual) s
            ON (m.note_key = s.note_key AND m.kind = s.kind)
          WHEN NOT MATCHED THEN INSERT (note_key, kind, category, source, confidence, model, updated_at, updated_by)
               VALUES (s.note_key, s.kind, :category, 'ai', :confidence, :model, SYSDATE, 'auto')`,
        { note_key: item.note_key, kind: item.kind, category: s.category, confidence: s.confidence, model: s.model }
      );
      if (!m.rowsAffected) return; // someone added the note meanwhile: leave it
      out.saved++;
      const fallback = FALLBACK[item.kind];
      if (s.confidence >= AI_MIN_CONFIDENCE && s.category !== fallback) {
        out.confident++;
        // the same records as found above, still "other"
        const u = await executeQuery(
          c,
          `UPDATE expense SET category = :category
            WHERE category = :fallback AND ${KIND_SQL} = :kind
              AND fulldate >= TRUNC(SYSDATE) - :days AND ${NOTE_KEY_SQL} = :note_key`,
          { category: s.category, fallback, kind: item.kind, days, note_key: item.note_key }
        );
        out.records_updated += u.rowsAffected || 0;
      }
    });
  }
  out.ms = Date.now() - started;
  return out;
}

module.exports = { aiSweep };
