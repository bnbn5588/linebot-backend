const { executeQuery } = require("./db");
const { isTextWithin } = require("./utilities");
const { NOTE_KEY_SQL } = require("./categories");

// Rename / delete wallets. Shared by the bot endpoint (/api/manageWallet) and
// the web app (/api/me-wallets). Every query is scoped to `uname`.

const NAME_MAX_BYTES = 150; // WALLET.WALLET_NAME is VARCHAR2(150)

// Collapse spaces; null when empty or too long.
function cleanName(name) {
  if (typeof name !== "string") return null;
  const n = name.replace(/\s+/g, " ").trim();
  return isTextWithin(n, NAME_MAX_BYTES) ? n : null;
}

// Every wallet with its record count and balance, plus which one is current.
async function walletStats(connection, uname) {
  const r = await executeQuery(
    connection,
    `SELECT w.wallet_id, w.wallet_name, w.timezone,
            (SELECT COUNT(*) FROM expense e WHERE e.uname = w.uname AND e.wallet_id = w.wallet_id),
            (SELECT NVL(SUM(e.exvalue), 0) FROM expense e WHERE e.uname = w.uname AND e.wallet_id = w.wallet_id),
            CASE WHEN u.wallet_id = w.wallet_id THEN 1 ELSE 0 END
       FROM wallet w LEFT JOIN users u ON u.uname = w.uname
      WHERE w.uname = :uname
      ORDER BY w.wallet_id`,
    { uname }
  );
  return r.rows.map(([wallet_id, wallet_name, timezone, records, balance, cur]) => ({
    wallet_id, wallet_name, timezone, records, balance, current: cur === 1,
  }));
}

async function findWallet(connection, uname, walletId) {
  const r = await executeQuery(
    connection,
    "SELECT wallet_id, wallet_name, timezone FROM wallet WHERE uname = :uname AND wallet_id = :wallet_id",
    { uname, wallet_id: walletId }
  );
  const row = r.rows[0];
  return row ? { wallet_id: row[0], wallet_name: row[1], timezone: row[2] } : null;
}

async function renameWallet(connection, uname, walletId, name) {
  const old = await findWallet(connection, uname, walletId);
  if (!old) return null;
  await executeQuery(
    connection,
    "UPDATE wallet SET wallet_name = :name WHERE uname = :uname AND wallet_id = :wallet_id",
    { name, uname, wallet_id: walletId }
  );
  return { ...old, old_name: old.wallet_name, wallet_name: name };
}

// Deletes the wallet, its records and its budgets in one transaction.
// Returns { error: "NOT_FOUND" | "LAST_WALLET" | "NAME_MISMATCH" } or the result.
// `expectName` (optional) must equal the wallet's current name: a stale
// confirm button cannot delete a newer wallet that reused the same id.
async function deleteWallet(connection, uname, walletId, expectName) {
  const all = await walletStats(connection, uname);
  const target = all.find((w) => w.wallet_id === walletId);
  if (!target) return { error: "NOT_FOUND" };
  if (expectName !== undefined && expectName !== null && cleanName(expectName) !== cleanName(target.wallet_name || "")) {
    return { error: "NAME_MISMATCH" };
  }
  if (all.length < 2) return { error: "LAST_WALLET" };
  const next = target.current ? all.find((w) => w.wallet_id !== walletId) : all.find((w) => w.current);
  const opts = { autoCommit: false };
  try {
    const del = await executeQuery(connection, "DELETE FROM expense WHERE uname = :uname AND wallet_id = :wallet_id", { uname, wallet_id: walletId }, opts);
    await executeQuery(connection, "DELETE FROM budget WHERE uname = :uname AND wallet_id = :wallet_id", { uname, wallet_id: walletId }, opts);
    await executeQuery(connection, "DELETE FROM wallet WHERE uname = :uname AND wallet_id = :wallet_id", { uname, wallet_id: walletId }, opts);
    if (target.current) {
      await executeQuery(connection, "UPDATE users SET wallet_id = :wallet_id WHERE uname = :uname", { wallet_id: next.wallet_id, uname }, opts);
    }
    // Forget remembered categories of notes that no longer appear in any record
    await executeQuery(
      connection,
      `DELETE FROM category_memory m WHERE m.uname = :uname AND NOT EXISTS
         (SELECT 1 FROM expense WHERE uname = m.uname AND ${NOTE_KEY_SQL} = m.note_key)`,
      { uname },
      opts
    );
    await connection.commit();
    return {
      wallet_id: walletId,
      wallet_name: target.wallet_name,
      records: del.rowsAffected,
      current: next ? { wallet_id: next.wallet_id, wallet_name: next.wallet_name, timezone: next.timezone } : null,
    };
  } catch (e) {
    try { await connection.rollback(); } catch { /* ignore */ }
    throw e;
  }
}

module.exports = { cleanName, walletStats, findWallet, renameWallet, deleteWallet, NAME_MAX_BYTES };
