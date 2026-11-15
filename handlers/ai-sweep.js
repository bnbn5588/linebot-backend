const apiKeyMiddleware = require("../apiKeyMiddleware");
const { aiSweep } = require("../components/aiSweep");

// POST /api/ai-sweep — ask Gemini again for recent "other" records whose note
// was never answered (see components/aiSweep.js). API key only; run once a
// day by scripts/ai-sweep.sh. Optional body { days (1-31), max (1-50) }.
// Returns counts only.
module.exports = async (req, res) => {
  apiKeyMiddleware(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({ status: "error", message: "Use POST." });
    }
    const body = req.body || {};
    const num = (v, lo, hi, d) => {
      if (v === undefined) return d;
      const n = Number(v);
      return Number.isInteger(n) && n >= lo && n <= hi ? n : NaN;
    };
    const days = num(body.days, 1, 31, 7);
    const max = num(body.max, 1, 50, 20);
    if (Number.isNaN(days) || Number.isNaN(max)) {
      return res.status(400).json({ status: "error", message: "'days' must be 1-31 and 'max' 1-50." });
    }
    try {
      const data = await aiSweep({ days, max });
      res.status(200).json({ status: "success", data });
    } catch (error) {
      console.error("Error in /ai-sweep:", error.message);
      res.status(500).json({ status: "error", message: "Internal Server Error" });
    }
  });
};
