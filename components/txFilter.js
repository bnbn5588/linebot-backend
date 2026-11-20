const { typeCondition } = require("./utilities");
const { CATEGORIES } = require("./categories");

const CATEGORY_KEYS = new Set(CATEGORIES.map((c) => c.key));
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// The record filters the web page uses, as SQL for `expense` (append after
// "WHERE uname = :uname AND wallet_id = :wallet_id"). Shared by
// me-transactions (the list) and me-export (the CSV), so the file is exactly
// what the list shows.
//   month YYYY-MM | type income|expense|all | category <key> |
//   note <by-note key, exact> | q <text, contains>
// -> { sql, binds } or { error }
function buildTxFilter({ month, type, category, note, q } = {}) {
  const typeSql = typeCondition(type);
  if (typeSql === null) return { error: "Parameter 'type' must be 'income', 'expense' or 'all'." };
  let sql = typeSql;
  const binds = {};
  if (month !== undefined && month !== null && month !== "") {
    if (typeof month !== "string" || !MONTH_RE.test(month)) return { error: "Parameter 'month' must be in 'YYYY-MM' format." };
    sql += " AND fulldate >= TO_DATE(:month, 'YYYY-MM') AND fulldate < ADD_MONTHS(TO_DATE(:month, 'YYYY-MM'), 1)";
    binds.month = month;
  }
  if (category !== undefined && category !== null && category !== "") {
    if (!CATEGORY_KEYS.has(category)) return { error: "Unknown 'category'." };
    // Old records have no category yet; they count as "other"
    // (by sign, as in me-summary: > 0 income, otherwise expense)
    sql += category === "other_expense"
      ? " AND (category = :category OR (category IS NULL AND exvalue <= 0))"
      : category === "other_income"
        ? " AND (category = :category OR (category IS NULL AND exvalue > 0))"
        : " AND category = :category";
    binds.category = category;
  }
  if (note !== undefined && note !== null && note !== "") {
    // exact note, the same key as me-summary's by-note list (lower-case, trimmed)
    if (typeof note !== "string" || note.length > 500) return { error: "Parameter 'note' is too long." };
    if (note.trim()) { // only spaces = no note picked (same as me-summary)
      sql += " AND lower(trim(note)) = :note_key";
      binds.note_key = note.trim().toLowerCase();
    }
  }
  if (q !== undefined && q !== null && q !== "") {
    if (typeof q !== "string" || q.length > 100) return { error: "Parameter 'q' is too long." };
    if (q.trim()) {
      // Escape LIKE wildcards so the search is a plain "contains"
      const term = q.trim().toLowerCase().replace(/[\\%_]/g, (c) => "\\" + c);
      sql += " AND lower(note) LIKE :q ESCAPE '\\'";
      binds.q = `%${term}%`;
    }
  }
  return { sql, binds };
}

// Record order: new (default) | old | amount_desc | amount_asc. Amount sorts
// go by size (a -500 expense is bigger than a +100 income), ties newest first.
const ORDERS = {
  new: "fulldate DESC, trans_id DESC",
  old: "fulldate ASC, trans_id ASC",
  amount_desc: "ABS(exvalue) DESC, fulldate DESC, trans_id DESC",
  amount_asc: "ABS(exvalue) ASC, fulldate DESC, trans_id DESC",
};
// -> ORDER BY text, or null for an unknown sort; fallback when not given
function txOrder(sort, fallback = "new") {
  if (sort === undefined || sort === null || sort === "") return ORDERS[fallback];
  return Object.hasOwn(ORDERS, sort) ? ORDERS[sort] : null;
}

module.exports = { buildTxFilter, txOrder, MONTH_RE, CATEGORY_KEYS };
