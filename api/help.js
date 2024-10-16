const { helpCommand } = require("../components/utilities");
const apiKeyMiddleware = require("../apiKeyMiddleware");

// Vercel-compatible function
module.exports = async (req, res) => {
  apiKeyMiddleware(req, res, async () => {
    try {
      // Call the helpCommand function
      const message = helpCommand();

      // Return the message as a JSON response
      res.status(200).json({
        status: "success",
        data: message,
      });
    } catch (error) {
      console.error("Error generating help message:", error.message);
      res.status(500).json({
        status: "error",
        message: "Internal Server Error",
      });
    }
  });
};
