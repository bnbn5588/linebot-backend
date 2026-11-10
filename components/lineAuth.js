// LINE Login authentication for the LIFF web app.
//
// The browser sends the ID token from liff.getIDToken() as
//   Authorization: Bearer <id_token>
// and we ask LINE to verify it. LINE checks the signature, the expiry and that
// the token was issued for our LINE Login channel (client_id). The verified
// `sub` is the user's LINE userId, which is the `uname` used everywhere in the
// database (the LIFF channel must be under the same provider as the bot).
//
// Never trust a userId sent by the browser itself, and never put API_KEY in the
// web page: API_KEY can read every user's data.

const VERIFY_URL =
  process.env.LINE_VERIFY_URL || "https://api.line.me/oauth2/v2.1/verify";

// Channel ID of the LINE Login channel that owns the LIFF app. Not a secret
// (it is visible in every ID token). The env var overrides it, e.g. for tests.
const DEFAULT_LOGIN_CHANNEL_ID = "";

// Verified tokens are cached until they expire, so a page that makes several
// API calls verifies its token with LINE only once per function instance.
const cache = new Map();
const CACHE_MAX = 500;

async function verifyIdToken(idToken) {
  const now = Math.floor(Date.now() / 1000);
  const hit = cache.get(idToken);
  if (hit && hit.exp > now) {
    return hit.sub;
  }

  const channelId = process.env.LINE_LOGIN_CHANNEL_ID || DEFAULT_LOGIN_CHANNEL_ID;
  if (!channelId) {
    throw new Error("LINE Login channel ID is not configured");
  }

  const response = await fetch(VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
  });
  if (!response.ok) {
    return null; // invalid, expired, or issued for another channel
  }
  const claims = await response.json();
  if (typeof claims.sub !== "string" || !claims.sub || !(claims.exp > now)) {
    return null;
  }

  if (cache.size >= CACHE_MAX) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(idToken, { sub: claims.sub, exp: claims.exp });
  return claims.sub;
}

// Middleware-style wrapper: calls next(userId) for a valid token, otherwise
// answers 401 (or 500 if the server is misconfigured).
async function lineAuth(req, res, next) {
  const header = req.headers["authorization"] || "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) {
    return res
      .status(401)
      .json({ status: "error", message: "Missing LINE ID token." });
  }

  let userId;
  try {
    userId = await verifyIdToken(match[1]);
  } catch (error) {
    console.error("LINE token verification failed:", error.message);
    return res
      .status(500)
      .json({ status: "error", message: "Authentication is not available." });
  }
  if (!userId) {
    return res
      .status(401)
      .json({ status: "error", message: "Invalid or expired LINE ID token." });
  }
  return next(userId);
}

module.exports = { lineAuth, verifyIdToken };
