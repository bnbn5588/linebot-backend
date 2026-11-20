const { executeQuery } = require("./db");
const { isTextWithin } = require("./utilities");
const { NOTE_KEY_SQL } = require("./categories");

// Rename, trash, restore and purge wallets. Shared by the bot endpoint
// (/api/manageWallet), the web app (/api/me-wallets) and the daily purge
// (/api/purge-wallets). Every user query is scoped to `uname`.
//
// "Delete" moves a wallet to the trash (WALLET.DELETED_AT = now): it vanishes
// from every list and cannot be used, but its records and budgets stay. It can
// be restored for TRASH_DAYS days; after that the daily purge deletes it for good.
// Trashed wallets keep their id, so createWallet (MAX + 1) never reuses it.

const NAME_MAX_BYTES = 150; // WALLET.WALLET_NAME is VARCHAR2(150)
const TRASH_DAYS = 30;

// Collapse spaces; null when empty or too long.
function cleanName(name) {
  if (typeof name !== "string") return null;
  const n = name.replace(/\s+/g, " ").trim();
  return isTextWithin(n, NAME_MAX_BYTES) ? n : null;
}

// Every wallet with its record count and balance, which one is current, and
// for trashed ones the day they will be purged (YYYY-MM-DD, UTC) and days left.
async function walletStats(connection, uname) {
  const r = await executeQuery(
    connection,
    `SELECT w.wallet_id, w.wallet_name, w.timezone,
            (SELECT COUNT(*) FROM expense e WHERE e.uname = w.uname AND e.wallet_id = w.wallet_id),
            (SELECT NVL(SUM(e.exvalue), 0) FROM expense e WHERE e.uname = w.uname AND e.wallet_id = w.wallet_id),
            CASE WHEN u.wallet_id = w.wallet_id THEN 1 ELSE 0 END,
            TO_CHAR(w.deleted_at + ${TRASH_DAYS}, 'YYYY-MM-DD'),
            CASE WHEN w.deleted_at IS NULL THEN NULL ELSE GREATEST(0, CEIL(w.deleted_at + ${TRASH_DAYS} - SYSDATE)) END
       FROM wallet w LEFT JOIN users u ON u.uname = w.uname
      WHERE w.uname = :uname
      ORDER BY w.wallet_id`,
    { uname }
  );
  const all = r.rows.map(([wallet_id, wallet_name, timezone, records, balance, cur, purge_on, days_left]) => ({
    wallet_id, wallet_name, timezone, records, balance, current: cur === 1,
    trashed: purge_on !== null, purge_on, days_left,
  }));
  return { wallets: all.filter((w) => !w.trashed), trash: all.filter((w) => w.trashed) };
}

async function renameWallet(connection, uname, walletId, name) {
  const r = await executeQuery(
    connection,
    "SELECT wallet_name, timezone FROM wallet WHERE uname = :uname AND wallet_id = :wallet_id AND deleted_at IS NULL",
    { uname, wallet_id: walletId }
  );
  if (!r.rows.length) return null;
  await executeQuery(
    connection,
    "UPDATE wallet SET wallet_name = :name WHERE uname = :uname AND wallet_id = :wallet_id AND deleted_at IS NULL",
    { name, uname, wallet_id: walletId }
  );
  return { wallet_id: walletId, old_name: r.rows[0][0], wallet_name: name, timezone: r.rows[0][1] };
}

// Moves a wallet to the trash. Returns { error: "NOT_FOUND" | "LAST_WALLET" |
// "NAME_MISMATCH" } or the result. `expectName` (optional) must equal the
// wallet's current name, so a stale chat button never trashes another wallet.
async function trashWallet(connection, uname, walletId, expectName) {
  const { wallets } = await walletStats(connection, uname);
  const target = wallets.find((w) => w.wallet_id === walletId);
  if (!target) return { error: "NOT_FOUND" };
  if (expectName !== undefined && expectName !== null && cleanName(expectName) !== cleanName(target.wallet_name || "")) {
    return { error: "NAME_MISMATCH" };
  }
  if (wallets.length < 2) return { error: "LAST_WALLET" };
  const next = target.current ? wallets.find((w) => w.wallet_id !== walletId) : wallets.find((w) => w.current);
  const opts = { autoCommit: false };
  try {
    const u = await executeQuery(
      connection,
      "UPDATE wallet SET deleted_at = SYSDATE WHERE uname = :uname AND wallet_id = :wallet_id AND deleted_at IS NULL",
      { uname, wallet_id: walletId },
      opts
    );
    if (!u.rowsAffected) {
      await connection.rollback();
      return { error: "NOT_FOUND" }; // trashed by a second request just now
    }
    if (target.current) {
      await executeQuery(connection, "UPDATE users SET wallet_id = :wallet_id WHERE uname = :uname", { wallet_id: next.wallet_id, uname }, opts);
    }
    await connection.commit();
  } catch (e) {
    try { await connection.rollback(); } catch { /* ignore */ }
    throw e;
  }
  return {
    wallet_id: walletId,
    wallet_name: target.wallet_name,
    records: target.records,
    trash_days: TRASH_DAYS,
    current: next ? { wallet_id: next.wallet_id, wallet_name: next.wallet_name, timezone: next.timezone } : null,
  };
}

// Takes a wallet out of the trash. null when it is not in the trash.
async function restoreWallet(connection, uname, walletId) {
  const r = await executeQuery(
    connection,
    "SELECT wallet_name, timezone FROM wallet WHERE uname = :uname AND wallet_id = :wallet_id AND deleted_at IS NOT NULL",
    { uname, wallet_id: walletId }
  );
  if (!r.rows.length) return null;
  const u = await executeQuery(
    connection,
    "UPDATE wallet SET deleted_at = NULL WHERE uname = :uname AND wallet_id = :wallet_id AND deleted_at IS NOT NULL",
    { uname, wallet_id: walletId }
  );
  if (!u.rowsAffected) return null;
  return { wallet_id: walletId, wallet_name: r.rows[0][0], timezone: r.rows[0][1] };
}

// Deletes one trashed wallet for good: its records, budgets and the wallet,
// in one transaction, then forgets remembered categories of notes that no
// longer appear in any of the user's records.
async function purgeWallet(connection, uname, walletId) {
  const opts = { autoCommit: false };
  try {
    const w = await executeQuery(
      connection,
      "DELETE FROM wallet WHERE uname = :uname AND wallet_id = :wallet_id AND deleted_at IS NOT NULL",
      { uname, wallet_id: walletId },
      opts
    );
    if (!w.rowsAffected) {
      await connection.rollback();
      return null;
    }
    const del = await executeQuery(connection, "DELETE FROM expense WHERE uname = :uname AND wallet_id = :wallet_id", { uname, wallet_id: walletId }, opts);
    await executeQuery(connection, "DELETE FROM budget WHERE uname = :uname AND wallet_id = :wallet_id", { uname, wallet_id: walletId }, opts);
    await executeQuery(
      connection,
      `DELETE FROM category_memory m WHERE m.uname = :uname AND NOT EXISTS
         (SELECT 1 FROM expense WHERE uname = m.uname AND ${NOTE_KEY_SQL} = m.note_key)`,
      { uname },
      opts
    );
    await connection.commit();
    return { wallet_id: walletId, records: del.rowsAffected };
  } catch (e) {
    try { await connection.rollback(); } catch { /* ignore */ }
    throw e;
  }
}

// Daily job: purge every wallet trashed more than TRASH_DAYS days ago.
// Returns { wallets, records } counts (no names or users, for the log).
async function purgeExpired(connection) {
  const due = await executeQuery(
    connection,
    `SELECT uname, wallet_id FROM wallet WHERE deleted_at IS NOT NULL AND deleted_at + ${TRASH_DAYS} <= SYSDATE`,
    {}
  );
  let wallets = 0, records = 0;
  for (const [uname, walletId] of due.rows) {
    const r = await purgeWallet(connection, uname, walletId);
    if (r) { wallets++; records += r.records; }
  }
  return { wallets, records };
}

module.exports = { cleanName, walletStats, renameWallet, trashWallet, restoreWallet, purgeWallet, purgeExpired, NAME_MAX_BYTES, TRASH_DAYS };
