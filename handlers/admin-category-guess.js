const { getConnection, closeConnection } = require("../components/db");
const { adminAuth } = require("../components/adminAuth");
const { adminCors } = require("../components/adminCors");
const { explain, describe } = require("../components/categories");
const ai = require("../components/ai");
const { recordUsage } = require("../components/aiUsage");

// /api/admin-category-guess — "what category would this note get, and why?"
//   GET ?note=&kind=expense|income[&uname=][&ai=1]
// Runs the same steps as a real add (components/categories.js explain()),
// read-only: nothing is saved or remembered. uname (optional) includes that
// user's own remembered categories. ai=1 also asks Gemini (step "ai"; shown
// as a suggestion only — saving it is a separate PUT /api/admin-category-map).
// Admins only; CORS for the admin site.
const METHODS = "GET, OPTIONS";

function bad(res, message) {
  return res.status(400).json({ status: "error", message });
}

async function guess(req, res, connection) {
  const { note, kind, uname } = req.query;
  if (typeof note !== "string" || !note.trim()) return bad(res, "Parameter 'note' is required.");
  if (Buffer.byteLength(note, "utf8") > 250) return bad(res, "Parameter 'note' is too long.");
  if (kind !== "expense" && kind !== "income") return bad(res, "Parameter 'kind' must be expense or income.");
  if (uname !== undefined && (typeof uname !== "string" || uname.length > 100)) return bad(res, "Parameter 'uname' is invalid.");
  const amount = kind === "income" ? 1 : -1;
  const r = await explain(connection, uname || null, note, amount);
  const label = (key) => (key ? describe(key, amount) : null);
  if (req.query.ai === "1") {
    let step;
    if (!r.note_key) step = { step: "ai", category: null, error: "EMPTY", message: "Nothing left to ask after removing the #tag" };
    else {
      try {
        const s = await ai.suggestCategory(r.note_key, r.kind);
        await recordUsage(connection, "admin", s);
        step = { step: "ai", category: s.category, confidence: s.confidence, model: s.model };
      } catch (e) {
        if (!(e instanceof ai.AiError)) throw e;
        console.error("Gemini:", e.code, e.message);
        await recordUsage(connection, "admin", e);
        step = { step: "ai", category: null, error: e.code, message: e.message };
      }
    }
    step.used = false; // suggestion only: not part of the saved decision yet
    r.steps.splice(r.steps.length - 1, 0, step);
  }
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    status: "success",
    data: {
      note: r.note,
      note_key: r.note_key,
      kind: r.kind,
      category: label(r.category),
      source: r.source,
      steps: r.steps.map((s) => Object.assign({}, s, { category: label(s.category) },
        s.pending ? { pending: { category: label(s.pending.category), confidence: s.pending.confidence } } : {})),
    },
  });
}

module.exports = async (req, res) => {
  adminCors(req, res, METHODS);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ status: "error", message: "Use GET." });
  return adminAuth(req, res, async () => {
    let connection;
    try {
      connection = await getConnection();
      await guess(req, res, connection);
    } catch (error) {
      console.error("Error in /admin-category-guess:", error.message);
      res.status(500).json({ status: "error", message: "Internal Server Error" });
    } finally {
      await closeConnection(connection);
    }
  });
};
