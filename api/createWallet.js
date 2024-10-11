const {
  executeQuery,
  getConnection,
  closeConnection,
} = require("../components/db");
const apiKeyMiddleware = require("../apiKeyMiddleware");
const moment = require("moment-timezone");

module.exports = async (req, res) => {
  apiKeyMiddleware(req, res, async () => {
    // Check if the request method is POST
    if (req.method !== "POST") {
      return res
        .status(405)
        .json({ error: "Method Not Allowed. Use POST instead." });
    }

    const { uname, wallet_name, timezone } = req.body;

    // Validate required fields
    if (!uname || !wallet_name || !timezone) {
      return res.status(400).json({
        status: "error",
        message:
          "Missing required fields: 'uname', 'wallet_name', or 'timezone'.",
      });
    }

    // Validate the timezone
    if (!moment.tz.zone(timezone)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid timezone provided. Please provide a valid timezone.",
      });
    }

    let connection;
    try {
      // Establish a database connection
      connection = await getConnection();

      // 1. Fetch the maximum wallet_id for the user
      const sql_select_max_wallet =
        "SELECT MAX(wallet_id) FROM wallet WHERE UNAME = :uname";
      const data_max_wallet = { uname };
      const max_wallet_records = await executeQuery(
        connection,
        sql_select_max_wallet,
        data_max_wallet
      );

      let newWalletId;
      if (max_wallet_records.rows[0][0] === null) {
        // No wallet found, so start with wallet_id = 1
        newWalletId = 0;
      } else {
        // If a wallet was found, increment the max wallet_id by 1
        newWalletId = max_wallet_records.rows[0][0] + 1;
      }

      // 2. Insert the new wallet into the wallet table
      const sqlInsertWallet = `
        INSERT INTO wallet (uname, wallet_id, wallet_name, timezone)
        VALUES (:uname, :wallet_id, :wallet_name, :timezone)
      `;
      const dataInsert = [uname, newWalletId, wallet_name, timezone];
      const insertResult = await executeQuery(
        connection,
        sqlInsertWallet,
        dataInsert
      );

      if (insertResult.rowsAffected > 0) {
        // 3. Upsert operation for updating or inserting wallet_id in the USERS table
        const sqlUpsertUser = `
          MERGE INTO USERS u
          USING (SELECT :uname AS uname, :wallet_id AS wallet_id FROM dual) s
          ON (u.uname = s.uname)
          WHEN MATCHED THEN
              UPDATE SET u.wallet_id = s.wallet_id
          WHEN NOT MATCHED THEN
              INSERT (uname, wallet_id)
              VALUES (s.uname, s.wallet_id)
        `;
        const dataUpsert = [uname, newWalletId];
        await executeQuery(connection, sqlUpsertUser, dataUpsert);

        // Commit the transaction
        await connection.commit();

        // Success response
        res.status(200).json({
          status: "success",
          data: {
            wallet_id: newWalletId,
            wallet_name: wallet_name,
            timezone: timezone,
          },
        });
      } else {
        // Insertion failed
        res.status(500).json({
          status: "error",
          message: "Failed to create wallet.",
        });
      }
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
