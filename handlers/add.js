const {
  executeQuery,
  getConnection,
  closeConnection,
} = require("../components/db");
const apiKeyMiddleware = require("../apiKeyMiddleware");
const oracledb = require("oracledb");
const { categorize, describe } = require("../components/categories");
const { parseAmount, isMissing, isValidDateTime, isTextWithin } = require("../components/utilities");

module.exports = async (req, res) => {
  apiKeyMiddleware(req, res, async () => {
    // Check if the request method is POST
    if (req.method !== "POST") {
      return res
        .status(405)
        .json({ error: "Method Not Allowed. Use POST instead." });
    }

    const { uname, wallet_id, exvalue, targetdate, detail } = req.body || {};

    // 'detail' is required — normalise to a trimmed string before checking
    const note = typeof detail === "string" ? detail.trim() : "";

    // Validate required fields
    if (!uname || isMissing(wallet_id) || isMissing(exvalue) || !note) {
      console.log("Missing required fields:");
      return res.status(400).json({
        status: "error",
        message:
          "Missing required fields: 'uname', 'wallet_id', 'exvalue', or 'detail'.",
      });
    }

    // Types and sizes must fit the EXPENSE columns (UNAME 150 bytes, NOTE 250 bytes)
    if (!isTextWithin(uname, 150) || !/^\d{1,9}$/.test(String(wallet_id)) || !isTextWithin(note, 250)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid 'uname', 'wallet_id' or 'detail' (note is limited to 250 bytes).",
      });
    }

    // Validate exvalue strictly. parseFloat() alone silently accepts junk:
    // "-1,000" became -1 and "-120abc" became -120.
    const parsedValue = parseAmount(exvalue);
    if (parsedValue === null) {
      return res.status(400).json({
        status: "error",
        message:
          "Field 'exvalue' must be a non-zero number with at most 2 decimals and below 10,000,000 (e.g. -120, +1,500.50).",
      });
    }

    // Validate targetdate format: 'YYYY-MM-DD HH:MM:SS'
    if (!isValidDateTime(targetdate)) {
      return res.status(400).json({
        status: "error",
        message: "Field 'targetdate' must be in 'YYYY-MM-DD HH:MM:SS' format.",
      });
    }

    let connection;
    try {
      // Establish a database connection
      connection = await getConnection();

      // Pick a category (#tag > remembered > keyword > other). A recognised
      // #tag is removed from the stored note.
      const cat = await categorize(connection, uname, note, parsedValue);
      const storedNote = cat.note || note;

      const sql_insert_with_param =
        "INSERT INTO expense(UNAME,EXVALUE,FULLDATE,NOTE,WALLET_ID,CATEGORY) VALUES (:uname,:exvalue,TO_DATE(:targetdate, 'YYYY-MM-DD HH24:MI:SS'),:note,:wallet_id,:category) RETURNING trans_id INTO :id";
      const dataInsert = {
        uname,
        exvalue: parsedValue,
        targetdate,
        note: storedNote,
        wallet_id,
        category: cat.category,
        id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      };
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
            id: insertResult.outBinds.id[0],
            wallet_id: wallet_id,
            exvalue: parsedValue,
            detail: storedNote,
            category: { ...describe(cat.category, parsedValue), source: cat.source },
            targetdate: date,
            sum_day: records1.rows[0][1],
            targetmonth: records2.rows[0][0],
            sum_month: records2.rows[0][1],
          },
        });
      } else {
        // insertResult.rowsAffected was 0 / undefined — never leave the request hanging
        res.status(500).json({
          status: "error",
          message: "Failed to add record: no rows were inserted.",
        });
      }
    } catch (error) {
      console.error("Error in adding record:", error);
      res.status(500).json({
        status: "error",
        message: "An error occurred while adding record.",
      });
    } finally {
      // Ensure the connection is closed
      await closeConnection(connection);
    }
  });
};
