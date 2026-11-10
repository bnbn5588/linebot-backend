// Admin access for the admin dashboard: a valid LINE ID token (see lineAuth.js)
// whose LINE userId is in the admin list. User IDs are not secret; the env var
// ADMIN_USER_IDS (comma-separated) overrides the list below.
const { lineAuth } = require("./lineAuth");

const DEFAULT_ADMIN_USER_IDS = ["U0bc03a3db916459eeac5bd01c9708b8e"];

function adminIds() {
  const fromEnv = (process.env.ADMIN_USER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set(fromEnv.length ? fromEnv : DEFAULT_ADMIN_USER_IDS);
}

async function adminAuth(req, res, next) {
  return lineAuth(req, res, async (userId) => {
    if (!adminIds().has(userId)) {
      // Tell the caller their own ID so the owner can add it to the list.
      return res.status(403).json({
        status: "error",
        code: "NOT_ADMIN",
        user_id: userId,
        message: "This LINE account is not an admin.",
      });
    }
    return next(userId);
  });
}

module.exports = { adminAuth };
