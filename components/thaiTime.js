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

// EXPENSE with fulldate converted from each wallet's time zone to Thai time,
// as an inline view (uname, trans_id, fulldate). For counts and charts that
// mix wallets (the admin page); a user's own views keep the wallet's time.
// timezones: the distinct WALLET.timezone values. Each is matched with a
// bind and mapped to its canonical name; one the bot's moment-timezone does
// not know was recorded in UTC (the Firebase server's clock). Records with no
// wallet row are taken as Thai time.
function recordsInThaiTime(timezones) {
  const binds = {};
  const whens = [];
  timezones.forEach((tz, i) => {
    if (typeof tz !== "string") return;
    let zone;
    try {
      zone = new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone;
    } catch {
      zone = "UTC";
    }
    if (!/^[A-Za-z0-9_\/+-]{1,64}$/.test(zone)) zone = "UTC";
    binds[`tz${i}`] = tz;
    whens.push(`WHEN :tz${i} THEN '${zone}'`);
  });
  const zoneExpr = whens.length ? `CASE w.timezone ${whens.join(" ")} ELSE 'Asia/Bangkok' END` : "'Asia/Bangkok'";
  const sql = `(SELECT e.uname, e.trans_id,
                       CAST(FROM_TZ(CAST(e.fulldate AS TIMESTAMP), ${zoneExpr}) AT TIME ZONE 'Asia/Bangkok' AS DATE) AS fulldate
                  FROM expense e
                  LEFT JOIN wallet w ON w.uname = e.uname AND w.wallet_id = e.wallet_id)`;
  return { sql, binds };
}

module.exports = { TH_TODAY, TH_TODAY_START_UTC, thai, recordsInThaiTime };
