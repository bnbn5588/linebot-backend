const { getWallets } = require("../components/services");
const { getConnection, closeConnection } = require("../components/db");
const apiKeyMiddleware = require("../apiKeyMiddleware");

module.exports = async (req, res) => {
  apiKeyMiddleware(req, res, async () => {
    const { userid } = req.query; // Vercel passes query params via req.query

    let connection;

    try {
      // Establish a database connection
      connection = await getConnection();

      const wallets = await getWallets(connection, userid);

      if (wallets.length > 0) {
        const responseMessage = wallets.map((wallet) => ({
          wallet_id: wallet[0],
          wallet_name: wallet[1],
          timezone: wallet[2],
        }));

        res.status(200).json({
          status: "success",
          data: responseMessage,
        });
      } else {
        console.log("No wallets found for userid:", userid);
        res.status(404).json({
          status: "error",
          message: "No wallets found for the user",
        });
      }
    } catch (error) {
      console.error("Error retrieving wallets:", error);
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
