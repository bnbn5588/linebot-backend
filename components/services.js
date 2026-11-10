// walletService.js
const { executeQuery } = require("./db");

// Function to fetch the list of wallets for the given userid
async function getWallets(connection, userid) {
  const sqlQuery = `
    SELECT wallet_id, wallet_name, timezone
    FROM wallet
    WHERE uname = :uname
    ORDER BY 1
  `;
  const params = [userid];
  const result = await executeQuery(connection, sqlQuery, params);
  return result.rows;
}

// Function to fetch wallet details
async function getWallet(connection, userid) {
  const sqlQuery = `
      SELECT u.wallet_id, w.wallet_name, w.timezone
      FROM USERS u
      JOIN wallet w ON u.uname = w.uname AND u.wallet_id = w.wallet_id
      WHERE u.UNAME = :uname
      ORDER BY 1
    `;
  const params = [userid];
  const result = await executeQuery(connection, sqlQuery, params);
  return result.rows.length > 0 ? result.rows : null;
}

// Resolve which wallet a web request is about. With an explicit wallet_id the
// wallet must belong to the user; without one the user's current wallet is
// used. Returns { wallet_id, wallet_name, timezone } or null.
async function resolveWallet(connection, uname, walletIdParam) {
  if (walletIdParam !== undefined && walletIdParam !== "") {
    if (!/^\d{1,9}$/.test(String(walletIdParam))) {
      return null;
    }
    const result = await executeQuery(
      connection,
      "SELECT wallet_id, wallet_name, timezone FROM wallet WHERE uname = :uname AND wallet_id = :wallet_id",
      [uname, Number(walletIdParam)]
    );
    const row = result.rows[0];
    return row ? { wallet_id: row[0], wallet_name: row[1], timezone: row[2] } : null;
  }
  const current = await getWallet(connection, uname);
  if (!current) {
    return null;
  }
  const [wallet_id, wallet_name, timezone] = current[0];
  return { wallet_id, wallet_name, timezone };
}

module.exports = {
  getWallets,
  getWallet,
  resolveWallet,
};
