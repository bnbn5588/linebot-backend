const {
  executeQuery,
  getConnection,
  closeConnection,
} = require("../components/db");
const apiKeyMiddleware = require("../apiKeyMiddleware");

// Define the API endpoint for summing all expenses
module.exports = async (req, res) => {
  apiKeyMiddleware(req, res, async () => {
    // Get the userid and wallet_id from query parameters
    const { userid, wallet_id } = req.query;

    let connection;
    try {
      // Establish a database connection
      connection = await getConnection();

      const sql_select_with_param =
        "SELECT sum(EXVALUE), null as firstday from expense where UNAME = :uname and WALLET_ID = :wallet_id UNION SELECT null, TO_CHAR(min(fulldate),'YYYY-MM-DD') from expense where UNAME = :uname and WALLET_ID = :wallet_id";
      const data_tuple = [userid, wallet_id, userid, wallet_id];

      // Execute the SQL query
      const records = await executeQuery(
        connection,
        sql_select_with_param,
        data_tuple
      );

      if (records.rows[0][0] === null) {
        res.status(404).json({
          status: "error",
          message: `[${wallet_id}] No data found !!`,
        });
      } else {
        const record_sum = records.rows[0][0];
        const record_firstdate = records.rows[1][1];
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
