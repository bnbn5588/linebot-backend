// walletService.js
const { executeQuery } = require("./db");

// Function to fetch the list of wallets for the given userid
async function getWallets(connection, userid) {
  const sqlQuery = `
    SELECT wallet_id, wallet_name, timezone
    FROM wallet
    WHERE uname = :uname
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

module.exports = {
  getWallets,
  getWallet,
};
