const {
  executeQuery,
  getConnection,
  closeConnection,
} = require("../components/db");
const apiKeyMiddleware = require("../apiKeyMiddleware");

// Keep-warm endpoint. A scheduled GET every few minutes keeps the function
// instance alive and its Oracle connection pool logged in, so real users do
// not wait for a cold start. Runs a no-op query; reads and writes no data.
module.exports = async (req, res) => {
  apiKeyMiddleware(req, res, async () => {
    if (req.method !== "GET") {
      return res
        .status(405)
        .json({ error: "Method Not Allowed. Use GET instead." });
    }

    const started = Date.now();
    let connection;
    try {
      connection = await getConnection();
      await executeQuery(connection, "SELECT 1 FROM DUAL", []);
      res.status(200).json({
        status: "success",
        data: { db_ms: Date.now() - started },
      });
    } catch (error) {
      console.error("Ping failed:", error.message);
      res.status(500).json({
        status: "error",
        message: "Internal Server Error",
      });
    } finally {
      await closeConnection(connection);
    }
  });
};
