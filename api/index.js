// Single Vercel function for every endpoint.
//
// Previously each api/<name>.js was its own serverless function, so each one
// had its own cold start and its own Oracle connection pool. A user who ran
// a few different commands paid a cold start (plus a fresh DB login) on every
// one of them. Routing everything through one function means one warm
// instance and one pool serve all endpoints.
//
// vercel.json rewrites /api/<name> to /api/index?route=<name>. The public URLs
// (/api/add, /api/sumall, ...) are unchanged, so the LINE bot needs no change.

const routes = new Map([
  ["add", require("../handlers/add")],
  ["changeWallet", require("../handlers/changeWallet")],
  ["createWallet", require("../handlers/createWallet")],
  ["help", require("../handlers/help")],
  ["me", require("../handlers/me")],
  ["me-summary", require("../handlers/me-summary")],
  ["me-transactions", require("../handlers/me-transactions")],
  ["ping", require("../handlers/ping")],
  ["sumall", require("../handlers/sumall")],
  ["sumbymonth", require("../handlers/sumbymonth")],
  ["sumbynote", require("../handlers/sumbynote")],
  ["sumday", require("../handlers/sumday")],
  ["wallet", require("../handlers/wallet")],
  ["wallets", require("../handlers/wallets")],
]);

// The route comes from the rewrite (?route=<name>). Fall back to the last path
// segment in case the request reaches this function without the rewrite.
function routeName(req) {
  if (typeof req.query?.route === "string" && req.query.route) {
    return req.query.route;
  }
  const pathname = (req.url || "").split("?")[0];
  return pathname.split("/").filter(Boolean).pop() || "";
}

module.exports = async (req, res) => {
  const handler = routes.get(routeName(req));
  if (!handler) {
    return res.status(404).json({
      status: "error",
      message: "Not Found",
    });
  }
  return handler(req, res);
};
