const { executeQuery, getConnection, closeConnection } = require("./db");
const { noteKey, kindOf, fallbackFor, AI_MIN_CONFIDENCE } = require("./categories");
const ai = require("./ai");

// After a record was saved as "other" (no step found a category): ask Gemini
// once per note and remember the answer in the shared table (source 'ai',
// updated_by 'auto').
// - confidence >= AI_MIN_CONFIDENCE: the record gets that category now, and
//   every later record with the same note gets it via the shared table.
// - lower: the row waits for an admin ("AI ไม่แน่ใจ"); it is not used, and the
//   note is not asked again.
// - Gemini error/quota: nothing is stored, so the next record with this note
//   tries again.
// Only the note text and expense/income are sent to Gemini.
const DAILY_CAP = Number(process.env.AI_DAILY_CAP) || 200;

async function aiFill({ uname, id, note, amount }) {
  if (!ai.enabled()) return { skipped: "NO_KEY" };
  const key = noteKey(note);
  if (!key) return { skipped: "EMPTY" };
  const kind = kindOf(amount);
  let connection;
  try {
    connection = await getConnection();
    const existing = await executeQuery(
      connection,
      "SELECT 1 FROM category_map WHERE note_key = :note_key AND kind = :kind",
      { note_key: key, kind }
    );
    if (existing.rows.length) return { skipped: "KNOWN" };
    const today = await executeQuery(
      connection,
      "SELECT count(*) FROM category_map WHERE updated_by = 'auto' AND updated_at >= TRUNC(SYSDATE)",
      []
    );
    if (today.rows[0][0] >= DAILY_CAP) {
      console.warn(`aiFill: daily cap ${DAILY_CAP} reached`);
      return { skipped: "CAP" };
    }
    let s;
    try {
      s = await ai.suggestCategory(key, kind);
    } catch (e) {
      if (!(e instanceof ai.AiError)) throw e;
      console.error("aiFill Gemini:", e.code, e.message);
      return { skipped: e.code };
    }
    await executeQuery(
      connection,
      `MERGE INTO category_map m
       USING (SELECT :note_key AS note_key, :kind AS kind FROM dual) s
          ON (m.note_key = s.note_key AND m.kind = s.kind)
        WHEN NOT MATCHED THEN INSERT (note_key, kind, category, source, confidence, model, updated_at, updated_by)
             VALUES (s.note_key, s.kind, :category, 'ai', :confidence, :model, SYSDATE, 'auto')`,
      { note_key: key, kind, category: s.category, confidence: s.confidence, model: s.model }
    );
    let updated = 0;
    if (s.confidence >= AI_MIN_CONFIDENCE && s.category !== fallbackFor(amount) && id) {
      // only if the record is still "other" (the user may have changed it meanwhile)
      const r = await executeQuery(
        connection,
        "UPDATE expense SET category = :category WHERE trans_id = :id AND uname = :uname AND category = :fallback",
        { category: s.category, id, uname, fallback: fallbackFor(amount) }
      );
      updated = r.rowsAffected || 0;
    }
    return { category: s.category, confidence: s.confidence, updated };
  } catch (e) {
    console.error("aiFill:", e.message);
    return { skipped: "ERROR" };
  } finally {
    await closeConnection(connection);
  }
}

module.exports = { aiFill };
