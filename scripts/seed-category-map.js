// Fill the shared table CATEGORY_MAP from existing records: every note used at
// least MIN times (all users together) gets the category most of its records
// have, with source 'history'. "Other" categories are skipped (they would stop
// keyword guessing), and so are notes whose records disagree (top category
// under SHARE of the records). Rows that already exist are never changed, so
// admin/AI rows are safe and the script can be re-run.
//
// Dry run (default; prints counts only, no note text):
//   ENV_FILE=.env.dev node scripts/seed-category-map.js [--min=5] [--share=0.6]
// Write:
//   ENV_FILE=.env.dev node scripts/seed-category-map.js --apply
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", process.env.ENV_FILE || ".env") });
const oracledb = require("oracledb");
const { NOTE_KEY_SQL, isValidFor } = require("../components/categories");

const arg = (name, def) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? Number(a.split("=")[1]) : def; };
const APPLY = process.argv.includes("--apply");
const MIN = arg("min", 5);
const SHARE = arg("share", 0.6);

(async () => {
  const c = await oracledb.getConnection({ user: process.env.DB_USER, password: process.env.DB_PASS, connectString: process.env.DSN_NAME });
  console.log(`schema: ${(await c.execute("select user from dual")).rows[0][0]}  mode: ${APPLY ? "APPLY" : "dry run"}  min=${MIN} share=${SHARE}`);
  const rows = (await c.execute(
    `SELECT ${NOTE_KEY_SQL} AS k, CASE WHEN exvalue > 0 THEN 'income' ELSE 'expense' END AS kind,
            NVL(category, CASE WHEN exvalue > 0 THEN 'other_income' ELSE 'other_expense' END), count(*)
       FROM expense
      GROUP BY ${NOTE_KEY_SQL}, CASE WHEN exvalue > 0 THEN 'income' ELSE 'expense' END,
               NVL(category, CASE WHEN exvalue > 0 THEN 'other_income' ELSE 'other_expense' END)`
  )).rows;

  const notes = new Map(); // key|kind -> { total, cats: Map }
  for (const [k, kind, cat, n] of rows) {
    if (!k) continue;
    const id = k + "\u0000" + kind;
    const e = notes.get(id) || { k, kind, total: 0, cats: new Map() };
    e.total += n; e.cats.set(cat, (e.cats.get(cat) || 0) + n);
    notes.set(id, e);
  }
  let existing = new Set();
  try {
    existing = new Set((await c.execute("SELECT note_key || CHR(0) || kind FROM category_map")).rows.map((r) => r[0]));
  } catch (e) {
    if (e.errorNum !== 942 || APPLY) throw e; // dry run before migration 002: table not there yet
    console.log("(table CATEGORY_MAP does not exist yet)");
  }
  const stat = { eligible: 0, other: 0, mixed: 0, exists: 0, add: 0 };
  const byCat = {};
  const add = [];
  for (const e of notes.values()) {
    if (e.total < MIN) continue;
    stat.eligible++;
    const [cat, n] = [...e.cats.entries()].sort((a, b) => b[1] - a[1])[0];
    if (cat === "other_expense" || cat === "other_income" || !isValidFor(cat, e.kind === "income" ? 1 : -1)) { stat.other++; continue; }
    if (n / e.total < SHARE) { stat.mixed++; continue; }
    if (existing.has(e.k + "\u0000" + e.kind)) { stat.exists++; continue; }
    stat.add++; byCat[cat] = (byCat[cat] || 0) + 1;
    add.push({ note_key: e.k, kind: e.kind, category: cat });
  }
  console.log(`notes used >= ${MIN} times: ${stat.eligible}`);
  console.log(`  skipped, mostly "other": ${stat.other}`);
  console.log(`  skipped, records disagree: ${stat.mixed}`);
  console.log(`  skipped, already in table: ${stat.exists}`);
  console.log(`  to add: ${stat.add}`);
  for (const [k, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(16)} ${n}`);

  if (APPLY && add.length) {
    const r = await c.executeMany(
      `INSERT INTO category_map (note_key, kind, category, source, updated_at, updated_by)
       SELECT :note_key, :kind, :category, 'history', SYSDATE, 'seed' FROM dual
        WHERE NOT EXISTS (SELECT 1 FROM category_map WHERE note_key = :note_key AND kind = :kind)`,
      add,
      { autoCommit: true, bindDefs: { note_key: { type: oracledb.STRING, maxSize: 250 }, kind: { type: oracledb.STRING, maxSize: 7 }, category: { type: oracledb.STRING, maxSize: 30 } } }
    );
    console.log(`inserted: ${r.rowsAffected}`);
  }
  await c.close();
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
