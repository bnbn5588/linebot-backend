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
    const { uname, wallet_id } = req.query;

    let connection;
    try {
      // Establish a database connection
      connection = await getConnection();

      const sql_select_with_param =
        "select TO_CHAR(fulldate,'YYYY-MM'),sum(exvalue) from expense where UNAME = :uname and WALLET_ID = :wallet_id group by TO_CHAR(fulldate,'YYYY-MM') order by 1 asc";
      const data_tuple = [uname, wallet_id];

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
        // Initialize an array to hold the results
        const monthlyExpenses = [];

        // Map the rows to objects
        for (const row of records.rows) {
          const monthlyExpense = {
            month: row[0],
            totalExpense: row[1],
          };
          monthlyExpenses.push(monthlyExpense);
        }

        // Return both data as JSON
        res.status(200).json({
          status: "success",
          data: {
            wallet_id: wallet_id,
            monthlyExpenses: monthlyExpenses, // Return the array of monthly expenses
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
