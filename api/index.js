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
  ["admin-category-map", require("../handlers/admin-category-map")],
  ["admin-overview", require("../handlers/admin-overview")],
  ["changeWallet", require("../handlers/changeWallet")],
  ["categories", require("../handlers/categories")],
  ["createWallet", require("../handlers/createWallet")],
  ["deleteRecord", require("../handlers/record").deleteRecord],
  ["help", require("../handlers/help")],
  ["me", require("../handlers/me")],
  ["me-memory", require("../handlers/me-memory")],
  ["me-summary", require("../handlers/me-summary")],
  ["me-transactions", require("../handlers/me-transactions")],
  ["ping", require("../handlers/ping")],
  ["setCategory", require("../handlers/record").setCategory],
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
  // The rewrite's route wins; a client-supplied ?route= is ignored when it
  // conflicts (Vercel then gives an array).
  if (typeof req.query?.route === "string" && req.query.route) {
    return req.query.route;
  }
  const pathname = (req.url || "").split("?")[0];
  return pathname.split("/").filter(Boolean).pop() || "";
}

module.exports = async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  const handler = routes.get(routeName(req));
  if (!handler) {
    return res.status(404).json({
      status: "error",
      message: "Not Found",
    });
  }

  // Every parameter is a single string. Repeated keys (?a=1&a=2) or a[]= arrive
  // as arrays/objects and would otherwise reach SQL binds and string methods.
  for (const [key, value] of Object.entries(req.query || {})) {
    if (key !== "route" && typeof value !== "string") {
      return res.status(400).json({
        status: "error",
        message: `Parameter '${key}' must be given once.`,
      });
    }
  }

  // Vercel parses JSON bodies lazily and throws on malformed JSON.
  if (req.method === "POST" || req.method === "PUT") {
    let body;
    try {
      body = req.body;
    } catch {
      return res.status(400).json({ status: "error", message: "Invalid JSON body." });
    }
    if (body !== undefined && body !== null && body !== "" && (typeof body !== "object" || Array.isArray(body))) {
      return res.status(400).json({ status: "error", message: "Body must be a JSON object." });
    }
  }

  return handler(req, res);
};
