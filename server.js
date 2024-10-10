const express = require("express");
const app = express();

// Middleware to parse JSON
app.use(express.json());

// Example route
app.get("/api/hello", (req, res) => {
  res.send("Hello, world!");
});

// Export as a Vercel function
module.exports = app;
