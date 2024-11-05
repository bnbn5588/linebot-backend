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
    const { uname, wallet_id, month } = req.query;

    let connection;
    try {
      // Establish a database connection
      connection = await getConnection();

      let sql_select_with_param;
      let data_tuple;
      if (month == null) {
        sql_select_with_param =
          "select lower(note), sum(exvalue), count(*) as count from expense where UNAME = :uname and WALLET_ID = :wallet_id group by lower(note) order by 2 asc";
        data_tuple = [uname, wallet_id];
      } else {
        sql_select_with_param =
          "select lower(note), sum(exvalue), count(*) as count from expense where UNAME = :uname and WALLET_ID = :wallet_id and TO_CHAR(fulldate,'YYYY-MM') = :month group by lower(note) order by 2 asc";
        data_tuple = [uname, wallet_id, month];
      }

      // Execute the SQL query
      const records = await executeQuery(
        connection,
        sql_select_with_param,
        data_tuple
      );

      if (records.rows.length == 0) {
        res.status(404).json({
          status: "error",
          message: `[${wallet_id}] No data found !!`,
        });
      } else {
        // Initialize an array to hold the results
        const groupedExpenses = [];

        // Map the rows to objects
        for (const row of records.rows) {
          const expense = {
            note: row[0],
            totalExpense: row[1],
            count: row[2],
          };
          groupedExpenses.push(expense);
        }

        // Return both data as JSON
        res.status(200).json({
          status: "success",
          data: {
            wallet_id: wallet_id,
            groupedExpenses: groupedExpenses, // Return the array of monthly expenses
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
