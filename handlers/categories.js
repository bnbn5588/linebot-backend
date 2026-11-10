const apiKeyMiddleware = require("../apiKeyMiddleware");
const { publicList } = require("../components/categories");

// GET /api/categories — category list for the bot's "change category" menu.
module.exports = async (req, res) => {
  apiKeyMiddleware(req, res, async () => {
    if (req.method !== "GET") {
      return res.status(405).json({ status: "error", message: "Use GET." });
    }
    res.status(200).json({ status: "success", data: publicList() });
  });
};
