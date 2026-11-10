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

// A non-empty string that fits a VARCHAR2(n BYTE) column (Thai is 3 bytes/char).
function isTextWithin(value, maxBytes) {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    Buffer.byteLength(value, "utf8") <= maxBytes
  );
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
    // Keep in sync with the commands handled by line-bot-fb (functions/index.js)
    commands: [
      {
        name: "Add Transaction",
        command: "{+,-}amount note [-d YYYY-MM-DD] [-h HH:mm]",
        description:
          "Record an expense (use '-') or income (use '+') with a short note. Optionally set the date (-d) and/or time (-h). e.g. -120 lunch, +1,500 salary -d 2026-11-01",
      },
      {
        name: "Total Balance",
        command: "sumall",
        description:
          "Overall balance (income + expenses) of the current wallet since its first transaction.",
      },
      {
        name: "Monthly Total Balance",
        command: "sumbymonth",
        description: "Balance (income + expenses) for each month.",
      },
      {
        name: "Average Daily Balance",
        command: "avgbymonth",
        description: "Average daily balance (income + expenses) for each month.",
      },
      {
        name: "Group by Note",
        command: "sumbynote [-m [YYYY-MM]]",
        description:
          "Totals grouped by note, all-time. Add -m for this month, or -m YYYY-MM for a specific month.",
      },
      {
        name: "List Wallets",
        command: "wallet",
        description: "List your wallets. * marks the current one.",
      },
      {
        name: "Switch Wallet",
        command: "wallet [id]",
        description: "Switch the current wallet, e.g. wallet 1",
      },
      {
        name: "Create Wallet",
        command: "create [wallet_name] [timezone]",
        description:
          "Create a new wallet and make it current, e.g. create main Asia/Bangkok",
      },
      {
        name: "Random Restaurant",
        command: "(share your location)",
        description:
          "Share a location to get a random open restaurant within 1 km.",
      },
    ],
  };

  return res_message;
}

module.exports = {
  isValidDateTime,
  isTextWithin,
  isMissing,
  parseAmount,
  getMRange,
  checkDateInput,
  helpCommand,
};
