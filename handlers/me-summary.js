const {
  executeQuery,
  getConnection,
  closeConnection,
} = require("../components/db");
const { resolveWallet } = require("../components/services");
const { lineAuth } = require("../components/lineAuth");
const { typeCondition } = require("../components/utilities");
const { describe, CATEGORIES } = require("../components/categories");
// Today in the wallet's time zone (records are stored in wallet-local time).
function localDate(timeZone) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
const CATEGORY_KEYS = new Set(CATEGORIES.map((c) => c.key));

// GET /api/me-summary?wallet_id=&month=YYYY-MM
// Dashboard data for one wallet of the signed-in user: overall totals, a row
// per month (income / expense / balance) and totals by note for `month`
// (all time when month is omitted), totals by category (with the previous
// month's total for comparison, same days so far for the current month, and
// the 3-month average). With `category`, category_months has the
// per-month rows for that category only. With `note` (a by-note key), the
// same filter_months narrowed to that note; by_note entries also carry
// prev_total / avg_total.
module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ status: "error", message: "Use GET." });
  }
  return lineAuth(req, res, async (uname) => {
    const { wallet_id, month, type, category, note } = req.query;
    if (note !== undefined && (typeof note !== "string" || note.length > 500)) {
      return res.status(400).json({ status: "error", message: "Parameter 'note' is too long." });
    }
    // Same key as the by-note list: lower-case, trimmed
    const noteKey = note ? note.trim().toLowerCase() : "";
    const noteFilter = noteKey ? " AND lower(trim(note)) = :note_key" : "";
    if (category !== undefined && category !== "" && !CATEGORY_KEYS.has(category)) {
      return res.status(400).json({ status: "error", message: "Unknown 'category'." });
    }
    const typeSql = typeCondition(type);
    if (typeSql === null) {
      return res.status(400).json({
        status: "error",
        message: "Parameter 'type' must be 'income', 'expense' or 'all'.",
      });
    }
    if (month !== undefined && month !== "" && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({
        status: "error",
        message: "Parameter 'month' must be in 'YYYY-MM' format.",
      });
    }

    let connection;
    try {
      connection = await getConnection();
      const wallet = await resolveWallet(connection, uname, wallet_id);
      if (!wallet) {
        return res.status(404).json({ status: "error", message: "Wallet not found" });
      }
      const binds = { uname, wallet_id: wallet.wallet_id };

      const totals = await executeQuery(
        connection,
        `SELECT sum(exvalue),
                sum(CASE WHEN exvalue > 0 THEN exvalue ELSE 0 END),
                sum(CASE WHEN exvalue < 0 THEN exvalue ELSE 0 END),
                count(*),
                TO_CHAR(min(fulldate), 'YYYY-MM-DD'),
                TO_CHAR(max(fulldate), 'YYYY-MM-DD')
           FROM expense
          WHERE uname = :uname AND wallet_id = :wallet_id`,
        binds
      );

      const months = await executeQuery(
        connection,
        `SELECT TO_CHAR(fulldate, 'YYYY-MM'),
                sum(CASE WHEN exvalue > 0 THEN exvalue ELSE 0 END),
                sum(CASE WHEN exvalue < 0 THEN exvalue ELSE 0 END),
                sum(exvalue),
                count(*)
           FROM expense
          WHERE uname = :uname AND wallet_id = :wallet_id
          GROUP BY TO_CHAR(fulldate, 'YYYY-MM')
          ORDER BY 1`,
        binds
      );

      const monthFilter = month
        ? "AND fulldate >= TO_DATE(:month, 'YYYY-MM') AND fulldate < ADD_MONTHS(TO_DATE(:month, 'YYYY-MM'), 1)"
        : "";
      // By-note totals can be narrowed to one category (the category the user
      // tapped); old records without a category count as "other".
      const noteBinds = month ? { ...binds, month } : { ...binds };
      let categoryFilter = "";
      if (category) {
        // (old records count as "other" of their sign: > 0 income, else expense)
        categoryFilter = category === "other_expense"
          ? " AND (category = :category OR (category IS NULL AND exvalue <= 0))"
          : category === "other_income"
            ? " AND (category = :category OR (category IS NULL AND exvalue > 0))"
            : " AND category = :category";
        noteBinds.category = category;
      }
      const notes = await executeQuery(
        connection,
        `SELECT lower(trim(note)), sum(exvalue), count(*)
           FROM expense
          WHERE uname = :uname AND wallet_id = :wallet_id ${monthFilter}${typeSql}${categoryFilter}
          GROUP BY lower(trim(note))
          ORDER BY 2`,
        noteBinds
      );

      // Records saved before categories existed have CATEGORY = NULL: count
      // them as "other" of their kind.
      const cats = await executeQuery(
        connection,
        `SELECT NVL(category, CASE WHEN exvalue > 0 THEN 'other_income' ELSE 'other_expense' END) AS cat,
                sum(exvalue), count(*), min(exvalue)
           FROM expense
          WHERE uname = :uname AND wallet_id = :wallet_id ${monthFilter}${typeSql}
          GROUP BY NVL(category, CASE WHEN exvalue > 0 THEN 'other_income' ELSE 'other_expense' END)
          ORDER BY 2`,
        month ? { ...binds, month } : binds
      );

      // Comparison per category and per note (same filters as their lists):
      // - the month before `month`; when `month` is the wallet's current month
      //   (not over yet), only its first `days` days, the same days as so far
      // - the average of the 3 full months before `month`, divided by the
      //   months the wallet has records in (a new wallet is not averaged
      //   over empty months)
      let compare = null;
      const catExpr = "NVL(category, CASE WHEN exvalue > 0 THEN 'other_income' ELSE 'other_expense' END)";
      const empty = () => ({ prev: new Map(), avg: new Map() });
      let catCmp = empty();
      let noteCmp = empty();
      if (month) {
        const today = localDate(wallet.timezone); // YYYY-MM-DD in the wallet's zone
        const days = today.slice(0, 7) === month ? Number(today.slice(8, 10)) : null;
        const prevRange = `fulldate >= ADD_MONTHS(TO_DATE(:month, 'YYYY-MM'), -1)
              AND fulldate < LEAST(ADD_MONTHS(TO_DATE(:month, 'YYYY-MM'), -1) + :days, TO_DATE(:month, 'YYYY-MM'))`;
        const avgRange = "fulldate >= ADD_MONTHS(TO_DATE(:month, 'YYYY-MM'), -3) AND fulldate < TO_DATE(:month, 'YYYY-MM')";
        const n = await executeQuery(
          connection,
          `SELECT count(DISTINCT TO_CHAR(fulldate, 'YYYY-MM')) FROM expense
            WHERE uname = :uname AND wallet_id = :wallet_id AND ${avgRange}`,
          { ...binds, month }
        );
        const avgMonths = n.rows[0][0] || 0;
        // sums per group in both ranges; filter = extra SQL, extra = its binds
        const sums = async (groupExpr, filter, extra) => {
          const out = empty();
          const q = (range) => `SELECT ${groupExpr}, sum(exvalue) FROM expense
             WHERE uname = :uname AND wallet_id = :wallet_id AND ${range}${filter}
             GROUP BY ${groupExpr}`;
          const prev = await executeQuery(connection, q(prevRange), { ...binds, ...extra, month, days: days || 31 });
          for (const r of prev.rows) out.prev.set(r[0], r[1]);
          if (avgMonths) {
            const avg = await executeQuery(connection, q(avgRange), { ...binds, ...extra, month });
            for (const r of avg.rows) out.avg.set(r[0], Math.round((r[1] / avgMonths) * 100) / 100);
          }
          return out;
        };
        catCmp = await sums(catExpr, typeSql, {});
        noteCmp = await sums("lower(trim(note))", typeSql + categoryFilter, category ? { category } : {});
        compare = { prev_days: days, avg_months: avgMonths };
      }
      const cmpFields = (c, key) => ({
        prev_total: compare ? c.prev.get(key) || 0 : null,
        avg_total: compare && compare.avg_months ? c.avg.get(key) || 0 : null,
      });

      // With a category and/or note picked: the same per-month rows for those
      // records only (chart + month table follow the filter).
      let filterMonths = null;
      if (category || note) {
        filterMonths = await executeQuery(
          connection,
          `SELECT TO_CHAR(fulldate, 'YYYY-MM'),
                  sum(CASE WHEN exvalue > 0 THEN exvalue ELSE 0 END),
                  sum(CASE WHEN exvalue < 0 THEN exvalue ELSE 0 END),
                  sum(exvalue),
                  count(*)
             FROM expense
            WHERE uname = :uname AND wallet_id = :wallet_id${categoryFilter}${noteFilter}
            GROUP BY TO_CHAR(fulldate, 'YYYY-MM')
            ORDER BY 1`,
          { ...binds, ...(category ? { category } : {}), ...(note ? { note_key: noteKey } : {}) }
        );
      }
      const monthRows = (r) => r.rows.map((x) => ({ month: x[0], income: x[1], expense: x[2], balance: x[3], count: x[4] }));

      const t = totals.rows[0];
      res.status(200).json({
        status: "success",
        data: {
          wallet,
          totals: {
            balance: t[0] || 0,
            income: t[1] || 0,
            expense: t[2] || 0,
            count: t[3],
            first_date: t[4],
            last_date: t[5],
          },
          months: months.rows.map((r) => ({
            month: r[0],
            income: r[1],
            expense: r[2],
            balance: r[3],
            count: r[4],
          })),
          month: month || null,
          type: type || "all",
          category: category || null,
          by_note: notes.rows.map((r) => ({ note: r[0], total: r[1], count: r[2], ...cmpFields(noteCmp, r[0]) })),
          // prev_total: the same category in the month before (0 = none; null = no month);
          // avg_total: its average over the 3 months before
          by_category: cats.rows.map((r) => ({
            ...describe(r[0], r[3]),
            total: r[1],
            count: r[2],
            ...cmpFields(catCmp, r[0]),
          })),
          // prev_days: month is not over yet, prev_total covers days 1..prev_days
          // of the month before; avg_months: months averaged for avg_total
          compare,
          note: note ? noteKey : null,
          // per-month rows for the picked category and/or note (same shape as months)
          filter_months: filterMonths ? monthRows(filterMonths) : null,
          category_months: filterMonths ? monthRows(filterMonths) : null, // old name, for pages still open
        },
      });
    } catch (error) {
      console.error("Error in /me-summary:", error.message);
      res.status(500).json({ status: "error", message: "Internal Server Error" });
    } finally {
      await closeConnection(connection);
    }
  });
};
