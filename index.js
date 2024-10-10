const express = require("express");
const { getWallets, getWallet } = require("./components/services");

const app = express();
const port = 3000;

// Sample GET route
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "API is working" });
});

// Define API route to get wallets for a user
app.get("/api/wallets/:userid", async (req, res) => {
  const userid = req.params.userid;

  try {
    const wallets = await getWallets(userid);

    if (wallets.length > 0) {
      const responseMessage = wallets.map((wallet) => {
        return {
          wallet_id: wallet[0],
          wallet_name: wallet[1],
          timezone: wallet[2],
        };
      });

      res.status(200).json({
        status: "success",
        data: responseMessage,
      });
    } else {
      res.status(404).json({
        status: "error",
        message: "No wallets found for the user",
      });
    }
  } catch (error) {
    console.error("Error retrieving wallets:", error.message);
    res.status(500).json({
      status: "error",
      message: "Internal Server Error",
    });
  }
});

// Define the API route for fetching wallet details
app.get("/api/wallet/:userid", async (req, res) => {
  const userid = req.params.userid;

  try {
    const wallet = await getWallet(userid);

    if (wallet) {
      res.status(200).json({
        status: "success",
        wallet,
      });
    } else {
      res.status(404).json({
        status: "error",
        message: "Wallet not found",
      });
    }
  } catch (error) {
    console.error("Error retrieving wallet:", error.message);
    res.status(500).json({
      status: "error",
      message: "Internal Server Error",
    });
  }
});

// Start the Express server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
