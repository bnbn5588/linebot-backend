const {
  executeQuery,
  getConnection,
  closeConnection,
} = require("../components/db");
const { adminAuth } = require("../components/adminAuth");
const { adminCors } = require("../components/adminCors");

// GET /api/admin-overview — data for the admin website (a separate site/domain).
// Auth: LINE ID token of an admin (components/adminAuth.js), CORS limited to
// the admin site's origin. Shows usage counts and activity per user, never
// amounts or record contents.

const instanceStarted = Date.now();
let requestsServed = 0;

async function rows(connection, sql, binds = []) {
  return (await executeQuery(connection, sql, binds)).rows;
}

// LINE Messaging API (optional: needs the bot's channel access token as LB_KEY)
async function lineGet(path) {
  const token = process.env.LB_KEY;
  if (!token) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch("https://api.line.me" + path, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    if (!r.ok) return { error: r.status };
    return await r.json();
  } catch (e) {
    return { error: e.name === "AbortError" ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

async function lineInfo(userIds) {
  if (!process.env.LB_KEY) return { configured: false };
  const yesterday = new Date(Date.now() - 864e5 + 9 * 3600e3) // LINE insight dates are in JST
    .toISOString().slice(0, 10).replace(/-/g, "");
  const [quota, consumption, followers, bot, ...profiles] = await Promise.all([
    lineGet("/v2/bot/message/quota"),
    lineGet("/v2/bot/message/quota/consumption"),
    lineGet(`/v2/bot/insight/followers?date=${yesterday}`),
    lineGet("/v2/bot/info"),
    ...userIds.map((id) => lineGet(`/v2/bot/profile/${encodeURIComponent(id)}`)),
  ]);
  const names = {};
  userIds.forEach((id, i) => {
    const p = profiles[i];
    if (p && !p.error) names[id] = { name: p.displayName, picture: p.pictureUrl || null };
  });
  return {
    configured: true,
    bot: bot && !bot.error ? { name: bot.displayName, basic_id: bot.basicId, picture: bot.pictureUrl || null } : null,
    quota: quota && !quota.error ? quota : null, // { type: "none" | "limited", value? }
    consumption: consumption && !consumption.error ? consumption.totalUsage : null,
    followers: followers && !followers.error ? followers : null, // { status, followers, targetedReaches, blocks }
    names,
    errors: [quota, consumption, followers, bot].filter((x) => x && x.error).map((x) => x.error),
  };
}

module.exports = async (req, res) => {
  adminCors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "GET") {
    return res.status(405).json({ status: "error", message: "Use GET." });
  }
  return adminAuth(req, res, async () => {
    requestsServed++;
    let connection;
    try {
      const t0 = Date.now();
      connection = await getConnection();
      const tConn = Date.now() - t0;
      const t1 = Date.now();
      await executeQuery(connection, "SELECT 1 FROM DUAL", []);
      const tPing = Date.now() - t1;

      const [counts] = await rows(
        connection,
        `SELECT (SELECT count(*) FROM users),
                (SELECT count(*) FROM wallet),
                (SELECT count(*) FROM expense),
                (SELECT count(*) FROM expense WHERE fulldate >= TRUNC(SYSDATE) - 6),
                (SELECT count(*) FROM expense WHERE fulldate >= TRUNC(SYSDATE) - 29),
                (SELECT count(DISTINCT uname) FROM expense WHERE fulldate >= TRUNC(SYSDATE) - 6),
                (SELECT count(DISTINCT uname) FROM expense WHERE fulldate >= TRUNC(SYSDATE) - 29)
           FROM dual`
      );

      // Per user: activity only (no amounts). Users who only have a wallet
      // (never recorded anything) are included through the wallet table.
      const users = await rows(
        connection,
        `SELECT w.uname,
                w.wallets,
                NVL(e.records, 0),
                NVL(e.records_30d, 0),
                TO_CHAR(e.first_date, 'YYYY-MM-DD'),
                TO_CHAR(e.last_date, 'YYYY-MM-DD HH24:MI'),
                e.max_id
           FROM (SELECT uname, count(*) AS wallets FROM wallet GROUP BY uname) w
           LEFT JOIN (SELECT uname,
                             count(*) AS records,
                             count(CASE WHEN fulldate >= TRUNC(SYSDATE) - 29 THEN 1 END) AS records_30d,
                             min(fulldate) AS first_date,
                             max(fulldate) AS last_date,
                             max(trans_id) AS max_id
                        FROM expense GROUP BY uname) e
             ON e.uname = w.uname
          ORDER BY e.max_id DESC NULLS LAST`
      );

      const daily = await rows(
        connection,
        `SELECT TO_CHAR(TRUNC(fulldate), 'YYYY-MM-DD'), count(*), count(DISTINCT uname)
           FROM expense
          WHERE fulldate >= TRUNC(SYSDATE) - 59 AND fulldate < TRUNC(SYSDATE) + 1
          GROUP BY TRUNC(fulldate)
          ORDER BY 1`
      );

      const monthly = await rows(
        connection,
        `SELECT TO_CHAR(fulldate, 'YYYY-MM'), count(*), count(DISTINCT uname)
           FROM expense
          GROUP BY TO_CHAR(fulldate, 'YYYY-MM')
          ORDER BY 1`
      );

      const segments = await rows(
        connection,
        `SELECT s.segment_name, s.segment_type, sum(s.bytes),
                NVL(i.table_name, s.segment_name)
           FROM user_segments s
           LEFT JOIN user_indexes i ON i.index_name = s.segment_name
          GROUP BY s.segment_name, s.segment_type, i.table_name
          ORDER BY 3 DESC`
      );
      const quotas = await rows(connection, "SELECT tablespace_name, bytes, max_bytes FROM user_ts_quotas");
      const tables = await rows(
        connection,
        "SELECT table_name, num_rows, TO_CHAR(last_analyzed, 'YYYY-MM-DD') FROM user_tables ORDER BY table_name"
      );
      const [[version]] = await rows(connection, "SELECT version_full FROM product_component_version");
      const [[dbTime]] = await rows(connection, "SELECT TO_CHAR(SYSTIMESTAMP, 'YYYY-MM-DD\"T\"HH24:MI:SS TZH:TZM') FROM dual");

      const userIds = users.map((u) => u[0]);
      const line = await lineInfo(userIds);

      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({
        status: "success",
        data: {
          generated_at: new Date().toISOString(),
          counts: {
            users: counts[0],
            wallets: counts[1],
            records: counts[2],
            records_7d: counts[3],
            records_30d: counts[4],
            active_users_7d: counts[5],
            active_users_30d: counts[6],
          },
          users: users.map((u) => ({
            user_id: u[0],
            name: line.names?.[u[0]]?.name || null,
            picture: line.names?.[u[0]]?.picture || null,
            wallets: u[1],
            records: u[2],
            records_30d: u[3],
            first_date: u[4],
            last_date: u[5],
          })),
          daily: daily.map((d) => ({ date: d[0], records: d[1], users: d[2] })),
          monthly: monthly.map((m) => ({ month: m[0], records: m[1], users: m[2] })),
          db: {
            version,
            db_time: dbTime,
            connect_ms: tConn,
            ping_ms: tPing,
            segments: segments.map((s) => ({ name: s[0], type: s[1], bytes: s[2], table: s[3] })),
            total_bytes: segments.reduce((a, s) => a + s[2], 0),
            quotas: quotas.map((q) => ({ tablespace: q[0], bytes: q[1], max_bytes: q[2] })), // max_bytes -1 = unlimited
            tables: tables.map((t) => ({ table: t[0], num_rows: t[1], last_analyzed: t[2] })),
          },
          runtime: {
            region: process.env.VERCEL_REGION || "local",
            node: process.version,
            env: process.env.VERCEL_ENV || "local",
            instance_uptime_s: Math.round((Date.now() - instanceStarted) / 1000),
            instance_requests: requestsServed,
            memory_mb: Math.round(process.memoryUsage().rss / 1048576),
          },
          line: { ...line, names: undefined },
        },
      });
    } catch (error) {
      console.error("Error in /admin-overview:", error.message);
      res.status(500).json({ status: "error", message: "Internal Server Error" });
    } finally {
      await closeConnection(connection);
    }
  });
};
