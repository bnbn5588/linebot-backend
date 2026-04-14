// db.js
const oracledb = require("oracledb");

// Module-level pool — persists across warm Vercel invocations on the same container.
// poolMin:1 / poolMax:1 is intentional: each serverless instance handles one request
// at a time, so one connection is sufficient. The pool handles reconnection automatically
// if the connection goes stale during an idle period.
let pool;

async function getPool() {
  if (!pool) {
    pool = await oracledb.createPool({
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      connectString: process.env.DSN_NAME,
      poolMin: 1,        // keep 1 connection alive after first use
      poolMax: 1,        // never need more than 1 (1 req at a time per instance)
      poolIncrement: 0,  // don't grow beyond poolMax
      poolTimeout: 60,   // close idle connections after 60s
    });
  }
  return pool;
}

// Utility function for database connection
async function getConnection() {
  try {
    const p = await getPool();
    return p.getConnection();
  } catch (err) {
    console.error("Error establishing DB connection:", err);
    throw err;
  }
}

// Utility function to close the connection
async function closeConnection(connection) {
  try {
    if (connection) {
      await connection.close();
    }
  } catch (err) {
    console.error("Error closing connection:", err);
  }
}

// Utility function to execute queries
async function executeQuery(connection, query, params) {
  try {
    const result = await connection.execute(query, params, {
      autoCommit: true, // Commit automatically after query execution
    });
    return result;
  } catch (err) {
    console.error("Error executing query:", err);
    throw err;
  }
}

module.exports = {
  getConnection,
  executeQuery,
  closeConnection,
};
