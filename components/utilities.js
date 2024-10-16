function checkDateInput(indate) {
  // Check if input is valid (non-empty and non-null)
  if (!indate) {
    return -1;
  }

  // Split the input date by '-'
  const splited = indate.split("-");
  // Determine expected format based on number of parts
  let date_pattern;
  if (splited.length === 3) {
    // YYYY-MM-DD
    date_pattern = /^\d{4}-\d{2}-\d{2}$/;
  } else if (splited.length === 2) {
    // YYYY-MM
    date_pattern = /^\d{4}-\d{2}$/;
  } else if (splited.length === 1) {
    // YYYY
    date_pattern = /^\d{4}$/;
  } else {
    // Invalid number of parts
    return -1;
  }

  // Match input against pattern
  if (date_pattern.test(indate)) {
    return splited.length; // Return the number of valid components
  } else {
    return -1; // Invalid format
  }
}

function getMRange(indate) {
  const splited = indate.split("-");
  const nyear = parseInt(splited[0]);
  const nmonth = parseInt(splited[1]);

  const firstDayOfMonth = new Date(nyear, nmonth - 1, 1);
  const lastDayOfMonth = new Date(nyear, nmonth, 0);
  const mrange = [firstDayOfMonth.getDate(), lastDayOfMonth.getDate()];

  return mrange;
}

function helpCommand() {
  const res_message = {
    commands: [
      {
        name: "Add Transaction",
        command: "{+,-}10000 [detail]",
        description:
          "Record an expense (use '-') or income (use '+'). The optional detail can be included for a description of the transaction.",
      },
      {
        name: "Show Transactions",
        command: "show {YYYY-[MM]-[DD]}",
        description:
          "List all transactions on a specified date. The month (MM) and day (DD) can be omitted for broader results (e.g., show for a year or month).",
      },
      {
        name: "Sum Transactions",
        command: "sum {YYYY-[MM]-[DD]}",
        description:
          "Calculate the sum of all expenses on a specified date. The month (MM) and day (DD) can be omitted to sum expenses for a year or a month.",
      },
      {
        name: "Total Balance",
        command: "sumall",
        description:
          "Calculate the overall balance by summing all expenses and income from the wallet's starting date to the present.",
      },
      {
        name: "Monthly Total Balance",
        command: "sumbymonth",
        description:
          "Calculate the total balance for each month by summing all expenses and income from the starting date until the present.",
      },
      {
        name: "Daily Balance within Each Month",
        command: "avgbymonth",
        description:
          "Display the average daily balance for each month, showing the total of expenses and income per day.",
      },
    ],
  };

  return res_message;
}

module.exports = {
  getMRange,
  checkDateInput,
  helpCommand,
};
