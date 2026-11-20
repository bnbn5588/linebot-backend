// Date range for a 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD' period, as half-open
// bounds { start, end } ('YYYY-MM-DD'), so SQL can filter with
// fulldate >= TO_DATE(start) AND fulldate < TO_DATE(end) and use an index
// instead of TO_CHAR(fulldate) = :period. A shape-valid but impossible date
// (2026-13, 2026-02-30) gets an empty range: it matches nothing, as before.
function periodRange(period) {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(String(period || ""));
  const empty = { start: "1900-01-01", end: "1900-01-01" };
  if (!m) return empty;
  const y = Number(m[1]);
  const mo = m[2] ? Number(m[2]) : 1;
  const d = m[3] ? Number(m[3]) : 1;
  const start = new Date(Date.UTC(y, mo - 1, d));
  if (start.getUTCFullYear() !== y || start.getUTCMonth() !== mo - 1 || start.getUTCDate() !== d) return empty;
  const end = new Date(start);
  if (m[3]) end.setUTCDate(end.getUTCDate() + 1);
  else if (m[2]) end.setUTCMonth(end.getUTCMonth() + 1);
  else end.setUTCFullYear(end.getUTCFullYear() + 1);
  const iso = (x) => x.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

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

// Parse a transaction amount such as "-120", "+1,500.50" or 30000.
// Commas are only accepted as proper thousands separators ("1,000", not "1,0").
// Returns the number, or null if the input is not a valid non-zero amount that
// fits EXPENSE.EXVALUE NUMBER(9,2).
function parseAmount(input) {
  if (typeof input === "number") {
    input = String(input);
  }
  if (typeof input !== "string") {
    return null;
  }
  const s = input.trim();
  const pattern = /^[+-]?(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/;
  if (!pattern.test(s)) {
    return null;
  }
  const value = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(value) || value === 0 || Math.abs(value) >= 1e7) {
    return null;
  }
  return value;
}

// True when a required field was not provided. Unlike `!value`, the number 0
// counts as provided — wallet ids are 0-based, so wallet_id 0 is valid.
function isMissing(value) {
  return value === undefined || value === null || String(value).trim() === "";
}

// A real calendar date-time in 'YYYY-MM-DD HH:MM:SS' (rejects 2026-02-30, 24:00:00...)
function isValidDateTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(typeof s === "string" ? s : "");
  if (!m) return false;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d &&
    h < 24 && mi < 60 && se < 60
  );
}

// Records may be dated from 2000-01-01 up to one year after today (catches a
// mistyped year such as 2062 or 1926). Returns null when fine, else the message.
const MIN_RECORD_DATE = "2000-01-01";
function maxRecordDate(now = new Date()) {
  const d = new Date(now.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}
function dateRangeError(targetdate, now) {
  const day = String(targetdate).slice(0, 10), max = maxRecordDate(now);
  if (day < MIN_RECORD_DATE || day > max) {
    return `Field 'targetdate' must be between ${MIN_RECORD_DATE} and ${max}.`;
  }
  return null;
}

// A non-empty string that fits a VARCHAR2(n BYTE) column (Thai is 3 bytes/char).
function isTextWithin(value, maxBytes) {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    Buffer.byteLength(value, "utf8") <= maxBytes
  );
}

// Optional ?type= filter of the web app: "income" (exvalue > 0), "expense"
// (exvalue < 0) or all. Returns the SQL condition, or null if the value is invalid.
function typeCondition(type) {
  if (type === undefined || type === "" || type === "all") return "";
  if (type === "income") return " AND exvalue > 0";
  if (type === "expense") return " AND exvalue < 0";
  return null;
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

// Help text lives in components/help.js
function helpCommand(lang) {
  return require("./help").helpContent(lang);
}

module.exports = {
  typeCondition,
  isValidDateTime,
  dateRangeError,
  maxRecordDate,
  MIN_RECORD_DATE,
  isTextWithin,
  isMissing,
  parseAmount,
  getMRange,
  checkDateInput,
  periodRange,
  helpCommand,
};
