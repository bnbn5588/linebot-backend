// Times shown to people are Thai time (Asia/Bangkok, UTC+7, no DST).
// The DB clock (SYSDATE) is UTC, and columns filled with SYSDATE
// (updated_at, ...) hold UTC. EXPENSE.fulldate is different: it is the
// record's own local time (the wallet's time zone) and is never converted.

// Today's date in Thailand (a DATE at 00:00)
const TH_TODAY = "TRUNC(CAST(SYSTIMESTAMP AT TIME ZONE 'Asia/Bangkok' AS DATE))";
// The start of today in Thailand, as a UTC DATE (to compare with SYSDATE columns)
const TH_TODAY_START_UTC = `(${TH_TODAY} - 7/24)`;
// A UTC DATE column as Thai time
const thai = (col) => `CAST(FROM_TZ(CAST(${col} AS TIMESTAMP), 'UTC') AT TIME ZONE 'Asia/Bangkok' AS DATE)`;

module.exports = { TH_TODAY, TH_TODAY_START_UTC, thai };
