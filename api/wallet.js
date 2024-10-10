const { getWallet } = require("../components/services");
const { getConnection, closeConnection } = require("../components/db");
const apiKeyMiddleware = require("../apiKeyMiddleware");

// Vercel-compatible function
module.exports = async (req, res) => {
  apiKeyMiddleware(req, res, async () => {
    const { userid } = req.query; // Get userid from query parameters

    let connection;
    try {
      // Establish a database connection
      connection = await getConnection();

      // Fetch the wallet using the connection
      const wallet = await getWallet(connection, userid);

      if (wallet) {
        res.status(200).json({
          status: "success",
          data: wallet,
        });
      } else {
        res.status(404).json({
          status: "error",
          message: "Wallet not found",
        });
      }
    } catch (error) {
      console.error("Error retrieving wallet:", error.message);
      res.status(500).json({
        status: "error",
        message: "Internal Server Error",
      });
    } finally {
      // Ensure the connection is closed
      await closeConnection(connection);
    }
  });
};
