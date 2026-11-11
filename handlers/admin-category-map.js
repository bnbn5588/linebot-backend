const {
  executeQuery,
  getConnection,
  closeConnection,
} = require("../components/db");
const { adminAuth } = require("../components/adminAuth");
const { adminCors } = require("../components/adminCors");
const { NOTE_KEY_SQL, CATEGORIES, noteKey, publicList, adminList } = require("../components/categories");

// /api/admin-category-map — the shared note → category mapping used for
// every user (after the user's own memory, before keyword guessing).
//   GET                                  list + categories + record counts
//                                        + rules (every category's #tags, keywords, places)
//   PUT    body { note, category }       add or change (kind follows the category)
//          + ai: { confidence, model }   save an AI suggestion (source 'ai'); never
//                                        replaces an admin/history row (409)
//   DELETE ?note_key=&kind=              remove
// Admins only (LINE ID token, components/adminAuth.js); CORS for the admin site.
// Rows added by AI later have source 'ai'; saving a row here makes it 'admin'.
// Records already saved keep their category; only new records are affected.
const KIND = new Map(CATEGORIES.map((c) => [c.key, c.kind]));
const METHODS = "GET, PUT, DELETE, OPTIONS";

function bad(res, message) {
  return res.status(400).json({ status: "error", message });
}

async function list(req, res, connection) {
  const r = await executeQuery(
    connection,
    `SELECT m.note_key, m.kind, m.category, m.source, TO_CHAR(m.updated_at, 'YYYY-MM-DD HH24:MI'), NVL(e.cnt, 0), m.confidence, m.model
       FROM category_map m
       LEFT JOIN (SELECT ${NOTE_KEY_SQL} AS note_key,
                         CASE WHEN exvalue > 0 THEN 'income' ELSE 'expense' END AS kind,
                         count(*) AS cnt
                    FROM expense
                   GROUP BY ${NOTE_KEY_SQL}, CASE WHEN exvalue > 0 THEN 'income' ELSE 'expense' END) e
         ON e.note_key = m.note_key AND e.kind = m.kind
      ORDER BY m.updated_at DESC, m.note_key`,
    []
  );
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    status: "success",
    data: {
      categories: publicList(),
      rules: adminList(),
      items: r.rows.map(([note_key, kind, category, source, updated_at, records, confidence, model]) => ({
        note_key, kind, category, source, updated_at, records, confidence, model,
      })),
    },
  });
}

async function upsert(req, res, connection, adminId) {
  const { note, category } = req.body || {};
  const key = typeof note === "string" ? noteKey(note) : "";
  if (!key) return bad(res, "Field 'note' is required.");
  if (Buffer.byteLength(key, "utf8") > 250) return bad(res, "Field 'note' is too long.");
  const kind = typeof category === "string" ? KIND.get(category) : undefined;
  if (!kind) return bad(res, "Field 'category' must be a category key.");
  const fromAi = req.body.ai;
  if (fromAi !== undefined) {
    const c = fromAi && Number(fromAi.confidence);
    const model = fromAi && fromAi.model;
    if (!Number.isFinite(c) || c < 0 || c > 1 || typeof model !== "string" || !model || model.length > 60) {
      return bad(res, "Field 'ai' must be { confidence: 0-1, model }.");
    }
    const existing = await executeQuery(
      connection,
      "SELECT source FROM category_map WHERE note_key = :note_key AND kind = :kind",
      { note_key: key, kind }
    );
    const src = existing.rows[0] && existing.rows[0][0];
    if (src && src !== "ai") {
      return res.status(409).json({ status: "error", message: `This note is already in the table (source ${src}); AI does not replace it.` });
    }
    await executeQuery(
      connection,
      `MERGE INTO category_map m
       USING (SELECT :note_key AS note_key, :kind AS kind FROM dual) s
          ON (m.note_key = s.note_key AND m.kind = s.kind)
        WHEN MATCHED THEN UPDATE SET m.category = :category, m.source = 'ai', m.confidence = :confidence, m.model = :model, m.updated_at = SYSDATE, m.updated_by = :admin_id
        WHEN NOT MATCHED THEN INSERT (note_key, kind, category, source, confidence, model, updated_at, updated_by)
             VALUES (s.note_key, s.kind, :category, 'ai', :confidence, :model, SYSDATE, :admin_id)`,
      { note_key: key, kind, category, confidence: Math.round(c * 1000) / 1000, model, admin_id: adminId }
    );
    return res.status(200).json({ status: "success", data: { note_key: key, kind, category, source: "ai" } });
  }
  await executeQuery(
    connection,
    `MERGE INTO category_map m
     USING (SELECT :note_key AS note_key, :kind AS kind FROM dual) s
        ON (m.note_key = s.note_key AND m.kind = s.kind)
      WHEN MATCHED THEN UPDATE SET m.category = :category, m.source = 'admin', m.confidence = NULL, m.model = NULL, m.updated_at = SYSDATE, m.updated_by = :admin_id
      WHEN NOT MATCHED THEN INSERT (note_key, kind, category, source, updated_at, updated_by)
           VALUES (s.note_key, s.kind, :category, 'admin', SYSDATE, :admin_id)`,
    { note_key: key, kind, category, admin_id: adminId }
  );
  res.status(200).json({ status: "success", data: { note_key: key, kind, category, source: "admin" } });
}

async function remove(req, res, connection) {
  const { note_key, kind } = req.query;
  if (typeof note_key !== "string" || !note_key || (kind !== "expense" && kind !== "income")) {
    return bad(res, "Parameters 'note_key' and 'kind' (expense|income) are required.");
  }
  const r = await executeQuery(
    connection,
    "DELETE FROM category_map WHERE note_key = :note_key AND kind = :kind",
    { note_key, kind }
  );
  if (!r.rowsAffected) return res.status(404).json({ status: "error", message: "Not found" });
  res.status(200).json({ status: "success", data: { note_key, kind } });
}

const methods = { GET: list, PUT: upsert, DELETE: remove };

module.exports = async (req, res) => {
  adminCors(req, res, METHODS);
  if (req.method === "OPTIONS") return res.status(204).end();
  const action = Object.hasOwn(methods, req.method) ? methods[req.method] : null;
  if (!action) return res.status(405).json({ status: "error", message: "Use GET, PUT or DELETE." });
  return adminAuth(req, res, async (adminId) => {
    let connection;
    try {
      connection = await getConnection();
      await action(req, res, connection, adminId);
    } catch (error) {
      console.error(`Error in /admin-category-map ${req.method}:`, error.message);
      res.status(500).json({ status: "error", message: "Internal Server Error" });
    } finally {
      await closeConnection(connection);
    }
  });
};
