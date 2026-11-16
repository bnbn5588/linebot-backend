const { executeQuery } = require("./db");
const { describe, CATEGORIES } = require("./categories");
const BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

// Monthly budget per expense category, per wallet (BUDGET, migration 006).
// Set in the web app (/api/me-budget). The bot's reply after recording an
// expense says when that record takes the category past 80% of its budget
// or over it; the monthly summary card lists each budget's use.
// Months are the wallet's own months (records are stored in wallet time).

const NEAR = 0.8;
const MAX_AMOUNT = 10000000;
const CAT_EXPR = "NVL(category, CASE WHEN exvalue > 0 THEN 'other_income' ELSE 'other_expense' END)";
const IN_MONTH = "fulldate >= TO_DATE(:month, 'YYYY-MM') AND fulldate < ADD_MONTHS(TO_DATE(:month, 'YYYY-MM'), 1)";

const isNoTable = (e) => /ORA-00942/.test(e.message); // before migration 006
const isBudgetCategory = (key) => !!BY_KEY.get(key) && BY_KEY.get(key).kind === "expense";
const round2 = (n) => Math.round(n * 100) / 100;

// [{ key, icon, label, amount, spent, pct }] for one wallet and month,
// in category order. spent is a positive amount.
async function getBudgets(connection, uname, walletId, month) {
  let r;
  try {
    r = await executeQuery(
      connection,
      `SELECT b.category, b.amount, NVL(s.spent, 0)
         FROM budget b
         LEFT JOIN (SELECT ${CAT_EXPR} AS cat, -sum(exvalue) AS spent
                      FROM expense
                     WHERE uname = :uname AND wallet_id = :wallet_id AND exvalue < 0 AND ${IN_MONTH}
                     GROUP BY ${CAT_EXPR}) s ON s.cat = b.category
        WHERE b.uname = :uname AND b.wallet_id = :wallet_id`,
      { uname, wallet_id: walletId, month }
    );
  } catch (e) {
    if (isNoTable(e)) return [];
    throw e;
  }
  const order = [...BY_KEY.keys()];
  return r.rows
    .filter(([key]) => isBudgetCategory(key))
    .map(([key, amount, spent]) => {
      const d = describe(key, -1);
      return { key, icon: d.icon, label: d.label, amount, spent: round2(spent), pct: amount > 0 ? Math.round((spent / amount) * 100) : 0 };
    })
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

// amount null / 0 removes the budget. Returns false for a bad category/amount.
async function setBudget(connection, uname, walletId, category, amount) {
  if (!isBudgetCategory(category)) return false;
  if (amount === null || amount === 0) {
    await executeQuery(connection, "DELETE FROM budget WHERE uname = :uname AND wallet_id = :wallet_id AND category = :category",
      { uname, wallet_id: walletId, category });
    return true;
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount >= MAX_AMOUNT || round2(amount) !== amount) return false;
  await executeQuery(
    connection,
    `MERGE INTO budget b
     USING (SELECT :uname AS uname, :wallet_id AS wallet_id, :category AS category FROM dual) s
        ON (b.uname = s.uname AND b.wallet_id = s.wallet_id AND b.category = s.category)
      WHEN MATCHED THEN UPDATE SET b.amount = :amount, b.updated_at = SYSDATE
      WHEN NOT MATCHED THEN INSERT (uname, wallet_id, category, amount) VALUES (s.uname, s.wallet_id, s.category, :amount)`,
    { uname, wallet_id: walletId, category, amount }
  );
  return true;
}

// After `added` (a positive amount) joined `category` in the month of `date`
// (the record is already saved): { level: "near" | "over", ...budget } when
// it crossed 80% or went over the budget, else null.
// Never throws: a failed lookup must not fail the record it is about.
async function budgetAlert(connection, args) {
  try {
    return await crossed(connection, args);
  } catch (e) {
    console.error("budget alert:", e.message);
    return null;
  }
}
async function crossed(connection, { uname, walletId, category, date, added }) {
  if (!(added > 0) || !isBudgetCategory(category)) return null;
  const month = String(date).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const b = (await getBudgets(connection, uname, walletId, month)).find((x) => x.key === category);
  if (!b || !(b.amount > 0)) return null;
  const after = b.spent;
  const before = after - added;
  let level = null;
  if (after > b.amount && before <= b.amount) level = "over";
  else if (after >= b.amount * NEAR && before < b.amount * NEAR) level = "near";
  return level ? { level, month, ...b } : null;
}

module.exports = { getBudgets, setBudget, budgetAlert, isBudgetCategory, MAX_AMOUNT };
