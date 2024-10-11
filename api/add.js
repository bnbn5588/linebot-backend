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

    const { uname, wallet_id, exvalue, targetdate, detail } = req.body;

    // Validate required fields
    if (!uname || !wallet_id || !exvalue || !detail) {
      return res.status(400).json({
        status: "error",
        message:
          "Missing required fields: 'uname', 'wallet_id', 'exvalue', or 'detail'.",
      });
    }

    let connection;
    try {
      // Establish a database connection
      connection = await getConnection();

      const sql_insert_with_param =
        "INSERT INTO expense(UNAME,EXVALUE,FULLDATE,NOTE,WALLET_ID) VALUES (:uname,:exvalue,TO_DATE(:targetdate, 'YYYY-MM-DD HH24:MI:SS'),:note,:WALLET_ID)";
      const dataInsert = [uname, exvalue, targetdate, detail, wallet_id];
      const insertResult = await executeQuery(
        connection,
        sql_insert_with_param,
        dataInsert
      );

      if (insertResult.rowsAffected > 0) {
        const db_datefmt = "YYYY-MM-DD";
        const db_monthfmt = "YYYY-MM";

        const sql_select_with_param1 = `SELECT TO_CHAR(fulldate,'${db_datefmt}'), sum(EXVALUE) from expense where UNAME = :uname and WALLET_ID = :wallet_id and TO_CHAR(fulldate,'${db_datefmt}') = :jdate group by TO_CHAR(fulldate,'${db_datefmt}')`;
        const sql_select_with_param2 = `SELECT TO_CHAR(fulldate,'${db_monthfmt}'), sum(EXVALUE) from expense where UNAME = :uname and WALLET_ID = :wallet_id and TO_CHAR(fulldate,'${db_monthfmt}') = :jdate group by TO_CHAR(fulldate,'${db_monthfmt}')`;

        const date = targetdate.split(" ")[0];
        const yearMonth = date.slice(0, 7);

        const data_tuple1 = [uname, wallet_id, date];
        const data_tuple2 = [uname, wallet_id, yearMonth];

        // Execute the SQL query
        const records1 = await executeQuery(
          connection,
          sql_select_with_param1,
          data_tuple1
        );

        // Execute the SQL query
        const records2 = await executeQuery(
          connection,
          sql_select_with_param2,
          data_tuple2
        );

        
        // Success response
        res.status(200).json({
          status: "success",
          data: {
            wallet_id: wallet_id,
            exvalue: exvalue,
            detail: detail,
            targetdate: date,
            sum_day: records1.rows[0][1],
            targetmonth: records2.rows[0][0],
            sum_month: records2.rows[0][1],
          },
        });
      }
    } catch (error) {
      console.error("Error in adding record:", error);
      res.status(500).json({
        error: error.error,
        message: "An error occurred while adding record.",
      });
    } finally {
      // Ensure the connection is closed
      await closeConnection(connection);
    }
  });
};
