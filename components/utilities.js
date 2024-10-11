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

module.exports = {
  getMRange,
  checkDateInput,
};
