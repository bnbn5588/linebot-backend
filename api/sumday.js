const {
  executeQuery,
  getConnection,
  closeConnection,
} = require("../components/db");
const apiKeyMiddleware = require("../apiKeyMiddleware");
const { checkDateInput } = require("../components/utilities");

// Define the API endpoint for summing all expenses
module.exports = async (req, res) => {
  apiKeyMiddleware(req, res, async () => {
    // Get the userid and wallet_id from query parameters
    const { uname, wallet_id, date } = req.query;

    const datefmt = checkDateInput(date);
    // If datefmt is less than 0, return an error message
    if (datefmt < 0) {
      return res.status(400).json({
        status: "error",
        message: "Only date format 'YYYY-[MM]-[DD]' is allowed",
      });
    }

    let connection;
    let db_datefmt;
    if (datefmt === 1) {
      db_datefmt = "YYYY"; // Year only
    } else if (datefmt === 2) {
      db_datefmt = "YYYY-MM"; // Year and month
    } else if (datefmt === 3) {
      db_datefmt = "YYYY-MM-DD"; // Full date
    }

    try {
      // Establish a database connection
      connection = await getConnection();

      const sql_select_with_param = `SELECT TO_CHAR(fulldate,'${db_datefmt}'), sum(EXVALUE) from expense where UNAME = :uname and WALLET_ID = :wallet_id and TO_CHAR(fulldate,'${db_datefmt}') = :jdate group by TO_CHAR(fulldate,'${db_datefmt}')`;
      const data_tuple = [uname, wallet_id, date];

      // Execute the SQL query
      const records = await executeQuery(
        connection,
        sql_select_with_param,
        data_tuple
      );

      if (records.rows.length === 0) {
        res.status(404).json({
          status: "error",
          message: `[${wallet_id}] No data found !!`,
        });
      } else {
        const selected_date = records.rows[0][0];
        const total_balance = records.rows[0][1];
        // Return both data as JSON
        res.status(200).json({
          status: "success",
          data: {
            selected_date: selected_date,
            total_balance: total_balance,
          },
        });
      }
    } catch (error) {
      console.error("Error retrieving expenses:", error.message);
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
