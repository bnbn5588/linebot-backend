// db.js
const oracledb = require("oracledb");

// Utility function for database connection
async function getConnection() {
  try {
    const connection = await oracledb.getConnection({
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      connectString: process.env.DSN_NAME,
    });
    return connection;
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
