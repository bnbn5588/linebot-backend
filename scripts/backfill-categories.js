// Guess categories for records saved before categories existed (CATEGORY IS NULL).
// Uses the same rules as new records except #tags: remembered note → keyword.
// Records with no match stay NULL (shown as "other").
//
// Dry run (default): prints how many records would get each category. Nothing
// is written and no note text is printed.
//   ENV_FILE=.env.dev node scripts/backfill-categories.js
// Write the guesses (only rows that are still NULL are touched):
//   ENV_FILE=.env.dev node scripts/backfill-categories.js --apply
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", process.env.ENV_FILE || ".env") });
const oracledb = require("oracledb");
const { byKeyword, noteKey, isValidFor } = require("../components/categories");

const APPLY = process.argv.includes("--apply");

(async () => {
  const c = await oracledb.getConnection({ user: process.env.DB_USER, password: process.env.DB_PASS, connectString: process.env.DSN_NAME });
  console.log(`schema: ${(await c.execute("select user from dual")).rows[0][0]}  mode: ${APPLY ? "APPLY" : "dry run"}`);

  const memory = new Map();
  for (const [u, k, cat] of (await c.execute("SELECT uname, note_key, category FROM category_memory")).rows) memory.set(u + "\u0000" + k, cat);

  const rows = (await c.execute("SELECT trans_id, uname, exvalue, note FROM expense WHERE category IS NULL")).rows;
  const counts = {};
  const updates = [];
  for (const [id, uname, amount, note] of rows) {
    const remembered = memory.get(uname + "\u0000" + noteKey(note));
    const cat = remembered && isValidFor(remembered, amount) ? remembered : byKeyword(note, amount);
    const label = cat || "(no match, stays other)";
    counts[label] = (counts[label] || 0) + 1;
    if (cat) updates.push({ id, cat });
  }

  console.log(`records without category: ${rows.length}`);
  for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(26)} ${n}`);
  console.log(`would set: ${updates.length}`);

  if (APPLY && updates.length) {
    const r = await c.executeMany(
      "UPDATE expense SET category = :cat WHERE trans_id = :id AND category IS NULL",
      updates,
      { autoCommit: true, bindDefs: { cat: { type: oracledb.STRING, maxSize: 30 }, id: { type: oracledb.NUMBER } } }
    );
    console.log(`updated: ${r.rowsAffected}`);
  }
  await c.close();
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
