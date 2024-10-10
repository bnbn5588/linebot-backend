function checkDateInput(indate) {
  const splited = indate.split("-");
  if (splited.length < 1) {
    return -1;
  }
  let date_pattern;
  if (splited.length === 3) {
    date_pattern = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
  } else if (splited.length === 2) {
    date_pattern = /^([0-9]{4})-([0-9]{2})$/;
  } else if (splited.length === 1) {
    date_pattern = /^([0-9]{4})$/;
  }

  const z = indate.match(date_pattern);
  if (z) {
    return z.length - 1;
  } else {
    return -1;
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
