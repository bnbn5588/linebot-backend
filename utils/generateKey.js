const crypto = require("crypto");

const generateApiKey = () => {
  return crypto.randomBytes(32).toString("hex"); // Generates a random 64-character hexadecimal string
};

module.exports = generateApiKey;
