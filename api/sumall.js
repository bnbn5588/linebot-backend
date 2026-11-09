const {
  executeQuery,
  getConnection,
  closeConnection,
} = require("../components/db");
const apiKeyMiddleware = require("../apiKeyMiddleware");

// Define the API endpoint for summing all expenses
module.exports = async (req, res) => {
  apiKeyMiddleware(req, res, async () => {
    // Get the uname and wallet_id from query parameters
    const { uname, wallet_id } = req.query;

    if (!uname || !wallet_id) {
      return res.status(400).json({
        status: "error",
        message: "Missing required parameters: 'uname' or 'wallet_id'.",
      });
    }

    let connection;
    try {
      // Establish a database connection
      connection = await getConnection();

      // One aggregate query always returns exactly one row. The previous
      // UNION of two single-row queries collapsed to one row when the wallet
      // had no expenses (both rows were NULL,NULL), so rows[1] crashed with a 500.
      const sql_select_with_param =
        "SELECT sum(EXVALUE), TO_CHAR(min(fulldate),'YYYY-MM-DD'), count(*) from expense where UNAME = :uname and WALLET_ID = :wallet_id";
      const data_tuple = [uname, wallet_id];

      // Execute the SQL query
      const records = await executeQuery(
        connection,
        sql_select_with_param,
        data_tuple
      );

      if (records.rows[0][2] === 0) {
        res.status(404).json({
          status: "error",
          message: `[${wallet_id}] No data found !!`,
        });
      } else {
        const record_sum = records.rows[0][0];
        const record_firstdate = records.rows[0][1];
        // Return both data as JSON
        res.status(200).json({
          status: "success",
          data: {
            total_balance: record_sum,
            first_date: record_firstdate,
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
