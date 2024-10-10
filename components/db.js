// db.js
const oracledb = require("oracledb");
require("dotenv").config();

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

// Utility function to execute queries
async function executeQuery(query, params) {
  let connection;
  try {
    connection = await getConnection();
    const result = await connection.execute(query, params, {
      autoCommit: true,
    });
    return result;
  } catch (err) {
    console.error("Error executing query:", err);
    throw err;
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error("Error closing connection:", err);
      }
    }
  }
}

module.exports = {
  getConnection,
  executeQuery,
};
