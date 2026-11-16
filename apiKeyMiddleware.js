require("dotenv").config();
const crypto = require("crypto");

const API_KEY = process.env.API_KEY; // Store your API key in an environment variable

// Compare in constant time. Hashing first gives both sides the same length,
// so timingSafeEqual never throws and the key length is not leaked either.
const digest = (v) => crypto.createHash("sha256").update(String(v)).digest();
const keyMatches = (given) =>
  !!API_KEY && typeof given === "string" && given !== "" &&
  crypto.timingSafeEqual(digest(given), digest(API_KEY));

const apiKeyMiddleware = (req, res, next) => {
  const apiKey = req.headers["x-api-key"]; // Get the API key from request headers

  if (!keyMatches(apiKey)) {
    return res.status(403).json({
      status: "error",
      message: "Forbidden: Invalid API key",
    });
  }

  next(); // Proceed to the next middleware or route handler
};

module.exports = apiKeyMiddleware;
