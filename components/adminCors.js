// CORS for the admin website (a separate site/domain). Only origins in the
// list (env ADMIN_ORIGINS, comma-separated, overrides the default) get CORS headers.
const DEFAULT_ADMIN_ORIGINS = ["https://linebot-admin-six.vercel.app"];

function allowedOrigins() {
  const fromEnv = (process.env.ADMIN_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_ADMIN_ORIGINS;
}

function adminCors(req, res, methods = "GET, OPTIONS") {
  const origin = req.headers.origin;
  if (origin && allowedOrigins().includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", methods);
    res.setHeader("Access-Control-Max-Age", "600");
  }
}

module.exports = { adminCors, DEFAULT_ADMIN_ORIGINS };
