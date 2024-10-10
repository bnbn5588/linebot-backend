const {
  executeQuery,
  getConnection,
  closeConnection,
} = require("../components/db");
const apiKeyMiddleware = require("../apiKeyMiddleware");

module.exports = async (req, res) => {
  apiKeyMiddleware(req, res, async () => {
    // Check if the request method is POST
    if (req.method !== "POST") {
      return res
        .status(405)
        .json({ error: "Method Not Allowed. Use POST instead." });
    }

    const { uname, wallet_id } = req.body || {};

    // Check if required fields are provided
    if (!uname || !wallet_id) {
      return res.status(400).json({
        status: "error",
        message: "Missing required fields: 'uname' or 'wallet_id'.",
      });
    }

    let connection;
    try {
      // Establish a database connection
      connection = await getConnection();

      // 1. Fetch the maximum wallet_id for the user
      const sql_select_max_wallet =
        "SELECT MAX(wallet_id) FROM wallet WHERE UNAME = :uname";
      const data_max_wallet = { uname }; // Corrected data structure
      const max_wallet_records = await executeQuery(
        connection,
        sql_select_max_wallet,
        data_max_wallet
      );
      const max_wallet_id = max_wallet_records.rows[0][0];

      // 2. Validate the provided wallet_id
      if (wallet_id < 0 || wallet_id > max_wallet_id) {
        return res
          .status(400)
          .json({ message: "Please input a valid wallet_id." });
      }

      // 3. Check if the user is already using the selected wallet
      const sql_select_current_wallet =
        "SELECT u.wallet_id, w.wallet_name, w.timezone FROM USERS u JOIN WALLET w ON u.wallet_id = w.wallet_id AND u.uname = w.uname WHERE u.uname = :uname";
      const current_wallet_records = await executeQuery(
        connection,
        sql_select_current_wallet,
        { uname }
      );

      // Ensure current_wallet_records has data
      if (current_wallet_records.rows.length === 0) {
        return res.status(404).json({ message: "User not found." });
      }

      const current_wallet_id = current_wallet_records.rows[0][0];
      const current_wallet_name = current_wallet_records.rows[0][1];
      const current_wallet_tz = current_wallet_records.rows[0][2];

      if (wallet_id == current_wallet_id) {
        return res.status(200).json({
          message: `You are already using [${current_wallet_id}] ${current_wallet_name}`,
        });
      }

      // 4. Update the user's current wallet in the database
      const sql_update_wallet =
        "UPDATE USERS SET wallet_id = :wallet_id WHERE uname = :uname";
      await executeQuery(connection, sql_update_wallet, { wallet_id, uname });

      // 5. Fetch the updated wallet's name and timezone
      const sql_select_new_wallet =
        "SELECT wallet_id, wallet_name, timezone FROM wallet WHERE UNAME = :uname AND wallet_id = :wallet_id";
      const new_wallet_records = await executeQuery(
        connection,
        sql_select_new_wallet,
        {
          uname,
          wallet_id,
        }
      );

      // Ensure new_wallet_records has data
      if (new_wallet_records.rows.length === 0) {
        return res.status(404).json({ message: "Wallet not found." });
      }

      const new_wallet_id = new_wallet_records.rows[0][0];
      const new_wallet_name = new_wallet_records.rows[0][1];
      const new_wallet_tz = new_wallet_records.rows[0][2];

      // 6. Return a success message
      res.status(200).json({
        data: {
          new_wallet_id,
          new_wallet_name,
          new_wallet_tz,
          old_wallet_id: current_wallet_id,
          old_wallet_name: current_wallet_name,
          old_wallet_tz: current_wallet_tz,
        },
      });
    } catch (error) {
      console.error("Error in changing wallet:", error);
      res.status(500).json({
        error: error.error,
        message: "An error occurred while changing the wallet.",
      });
    } finally {
      // Ensure the connection is closed
      await closeConnection(connection);
    }
  });
};
