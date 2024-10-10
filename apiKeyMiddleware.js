const API_KEY = process.env.API_KEY; // Store your API key in an environment variable

const apiKeyMiddleware = (req, res, next) => {
  const apiKey = req.headers["x-api-key"]; // Get the API key from request headers

  if (!apiKey || apiKey !== API_KEY) {
    return res.status(403).json({
      status: "error",
      message: "Forbidden: Invalid API key",
    });
  }

  next(); // Proceed to the next middleware or route handler
};

module.exports = apiKeyMiddleware;