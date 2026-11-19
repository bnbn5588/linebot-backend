const { executeQuery, getConnection, closeConnection } = require("../components/db");
const { resolveWallet } = require("../components/services");
const { lineAuth } = require("../components/lineAuth");
const { describe } = require("../components/categories");
const { buildTxFilter, txOrder, MONTH_RE } = require("../components/txFilter");
const crypto = require("crypto");

// /api/me-export — the signed-in user's records for one wallet as CSV
// (UTF-8 with BOM so Excel reads Thai): the same records the web list shows.
// Times are the stored wallet time (fulldate), the same as the web page shows.
// Filters (same as me-transactions): month=YYYY-MM, type, category, note, q.
// month is required unless note or q is given (then: all months).
// sort=new|old|amount_desc|amount_asc as the list (default old: oldest first).
//   GET  ?wallet_id=&month=&type=&category=&note=&q=   (LINE token) -> the CSV
//   POST { wallet_id, month, type, category, note, q } (LINE token) -> { url } a short-lived link
//   GET  ?link=<signed>                                (no token)   -> the CSV
// The link exists because the LINE in-app browser on iPhone cannot save a
// file: the page opens the link in Safari instead (liff.openWindow external).
// It is stateless: AES-256-GCM over {uname, wallet, filters, expiry}, valid
// LINK_TTL_S. Encrypted, not just signed, so the LINE userId never appears in
// the URL (Vercel request logs, browser history).

const MAX_ROWS = 5000;
const LINK_TTL_S = 120;

function linkKey() {
  const secret = process.env.API_KEY;
  if (!secret) throw new Error("API_KEY is not set");
  return crypto.createHmac("sha256", secret).update("me-export-link-v2").digest();
}

function signLink(payload) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", linkKey(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(payload), "utf8"), c.final()]);
  return Buffer.concat([iv, enc, c.getAuthTag()]).toString("base64url");
}

// -> payload, "expired" or null
function readLink(link) {
  if (typeof link !== "string" || !/^[A-Za-z0-9_-]{40,2000}$/.test(link)) return null;
  const raw = Buffer.from(link, "base64url");
  let p;
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", linkKey(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(raw.length - 16));
    p = JSON.parse(Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString("utf8"));
  } catch (error) {
    if (error.message === "API_KEY is not set") throw error;
    return null; // wrong key / tampered / not JSON
  }
  if (!p || typeof p.u !== "string" || typeof p.e !== "number") return null;
  if (p.m !== null && !MONTH_RE.test(p.m)) return null;
  return p.e < Date.now() / 1000 ? "expired" : p;
}

function textError(res, status, message) {
  // the link is opened directly in Safari, so answer with readable text
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).send(message);
}

function cell(value, text = true) {
  let s = value === null || value === undefined ? "" : String(value);
  // Spreadsheet formula injection: a note like "=HYPERLINK(...)" must stay text
  // (not for the amount column, which is a number we produce, e.g. -120)
  if (text && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function amount(n) {
  return String(Math.round(Number(n) * 100) / 100);
}

// { month, type, category, note, q } from a query/body -> { filters, f } or { error }
function readFilters(src) {
  const pick = (k) => (typeof src[k] === "string" && src[k] !== "" ? src[k] : undefined);
  const filters = { month: pick("month"), type: pick("type"), category: pick("category"), note: pick("note"), q: pick("q"), sort: pick("sort") };
  if (!txOrder(filters.sort, "old")) return { error: "Parameter 'sort' must be new, old, amount_desc or amount_asc." };
  if (filters.note !== undefined && !filters.note.trim()) filters.note = undefined;
  if (filters.q !== undefined && !filters.q.trim()) filters.q = undefined;
  if (!filters.month && !filters.note && !filters.q) {
    return { error: "Parameter 'month' must be in 'YYYY-MM' format." };
  }
  const f = buildTxFilter(filters);
  return f.error ? { error: f.error } : { filters, f };
}

// ASCII only (Content-Disposition): expenses-0-2026-11-food-expense.csv,
// expenses-0-all-note.csv, expenses-0-all-search.csv
function fileName(walletId, { month, type, category, note, q }) {
  const parts = ["expenses", walletId, month || "all"];
  if (category) parts.push(category);
  if (note) parts.push("note");
  else if (q) parts.push("search");
  if (type && type !== "all") parts.push(type);
  return parts.join("-") + ".csv";
}

async function sendCsv(res, uname, wallet_id, filters, fromLink = false) {
  const fail = (status, message, thai) =>
    fromLink ? textError(res, status, thai || message) : res.status(status).json({ status: "error", message });
  let connection;
  try {
    connection = await getConnection();
    const wallet = await resolveWallet(connection, uname, wallet_id);
    if (!wallet) {
      return fail(404, "Wallet not found", "ไม่พบกระเป๋านี้");
    }
    const f = buildTxFilter(filters);
    if (f.error) return fail(400, f.error, "ลิงก์ไม่ถูกต้อง");
    const result = await executeQuery(
      connection,
      `SELECT TO_CHAR(fulldate, 'YYYY-MM-DD HH24:MI:SS'), exvalue, category, note
         FROM expense
        WHERE uname = :uname AND wallet_id = :wallet_id${f.sql}
        ORDER BY ${txOrder(filters.sort, "old") || txOrder("old")}
        FETCH FIRST :fetch ROWS ONLY`,
      { uname, wallet_id: wallet.wallet_id, ...f.binds, fetch: MAX_ROWS + 1 }
    );
    if (result.rows.length > MAX_ROWS) {
      return fail(413, `มีรายการเกิน ${MAX_ROWS} รายการ เลือกช่วงให้แคบลง`);
    }
    const lines = [["วันที่-เวลา", "ประเภท", "หมวด", "จำนวนเงิน", "โน้ต"].join(",")];
    for (const [datetime, exvalue, category, note] of result.rows) {
      lines.push([
        datetime,
        exvalue > 0 ? "รายรับ" : "รายจ่าย",
        describe(category, exvalue).label,
        amount(exvalue),
        note,
      ].map((v, i) => cell(v, i !== 3)).join(","));
    }
    const filename = fileName(wallet.wallet_id, filters);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Row-Count", String(result.rows.length));
    return res.status(200).send("\uFEFF" + lines.join("\r\n") + "\r\n");
  } catch (error) {
    console.error("Error in /me-export:", error.message);
    return fail(500, "Internal Server Error", "ส่งออกไม่สำเร็จ ลองใหม่อีกครั้ง");
  } finally {
    await closeConnection(connection);
  }
}

async function createLink(req, res, uname) {
  const body = req.body || {};
  const { wallet_id } = body;
  const r = readFilters(body);
  if (r.error) {
    return res.status(400).json({ status: "error", message: r.error });
  }
  const { filters, f } = r;
  if (wallet_id !== undefined && wallet_id !== null && !/^\d{1,15}$/.test(String(wallet_id))) {
    return res.status(400).json({ status: "error", message: "Field 'wallet_id' must be a number." });
  }
  let connection;
  try {
    connection = await getConnection();
    const wallet = await resolveWallet(connection, uname, wallet_id === undefined || wallet_id === null ? undefined : String(wallet_id));
    if (!wallet) {
      return res.status(404).json({ status: "error", message: "Wallet not found" });
    }
    // the page tells "nothing to export" itself instead of opening Safari for an empty file
    const count = await executeQuery(
      connection,
      `SELECT COUNT(*) FROM expense
        WHERE uname = :uname AND wallet_id = :wallet_id${f.sql}`,
      { uname, wallet_id: wallet.wallet_id, ...f.binds }
    );
    const rows = Number(count.rows[0][0]);
    if (rows > MAX_ROWS) {
      return res.status(413).json({ status: "error", message: `มีรายการเกิน ${MAX_ROWS} รายการ เลือกช่วงให้แคบลง` });
    }
    const link = signLink({
      u: uname, w: wallet.wallet_id, m: filters.month || null,
      t: filters.type || null, c: filters.category || null, n: filters.note || null, s: filters.q || null, o: filters.sort || null,
      e: Math.floor(Date.now() / 1000) + LINK_TTL_S,
    });
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ status: "success", data: { url: `/api/me-export?link=${link}`, rows, expires_in: LINK_TTL_S } });
  } catch (error) {
    console.error("Error in /me-export POST:", error.message);
    return res.status(500).json({ status: "error", message: "Internal Server Error" });
  } finally {
    await closeConnection(connection);
  }
}

module.exports = async (req, res) => {
  if (req.method === "POST") {
    return lineAuth(req, res, (uname) => createLink(req, res, uname));
  }
  if (req.method !== "GET") {
    return res.status(405).json({ status: "error", message: "Use GET or POST." });
  }
  if (req.query.link !== undefined) {
    let p;
    try {
      p = readLink(req.query.link);
    } catch (error) {
      console.error("Error in /me-export link:", error.message);
      return textError(res, 500, "ส่งออกไม่สำเร็จ ลองใหม่อีกครั้ง");
    }
    if (p === "expired") return textError(res, 410, "ลิงก์หมดอายุแล้ว กลับไปที่แอป LINE แล้วกด \"ส่งออก CSV\" ใหม่");
    if (!p) return textError(res, 403, "ลิงก์ไม่ถูกต้อง");
    const filters = { month: p.m || undefined, type: p.t || undefined, category: p.c || undefined, note: p.n || undefined, q: p.s || undefined, sort: p.o || undefined };
    if (!filters.month && !filters.note && !filters.q) return textError(res, 403, "ลิงก์ไม่ถูกต้อง");
    return sendCsv(res, p.u, String(p.w), filters, true);
  }
  return lineAuth(req, res, (uname) => {
    const r = readFilters(req.query);
    if (r.error) {
      return res.status(400).json({ status: "error", message: r.error });
    }
    return sendCsv(res, uname, req.query.wallet_id, r.filters);
  });
};
