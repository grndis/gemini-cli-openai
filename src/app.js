// Load environment variables with explicit path
require("dotenv").config({ path: __dirname + "/../.env" });

const express = require("express");
const cors = require("cors");
const { json, urlencoded } = require("body-parser");
const { authRouter } = require("./routes/auth");
const { openaiRouter } = require("./routes/openai");
const { healthRouter } = require("./routes/health");
const { authManager } = require("./services/auth");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(json({ limit: "10mb" }));
app.use(urlencoded({ extended: true }));

// Routes
app.use("/", healthRouter);
app.use("/auth", authRouter);
app.use("/v1", openaiRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.listen(PORT, () => {
  console.log(`\x1b[36mProxy listening on port ${PORT}\x1b[0m`);
  console.log(
    `\x1b[36mUsing credentials from ~/.gemini/oauth_creds.json\x1b[0m`,
  );

  // Start background token refresh service if enabled
  if (process.env.BACKGROUND_TOKEN_REFRESH === "true") {
    console.log(
      "\x1b[36mBackground token refresh service enabled. Starting...\x1b[0m",
    );
    authManager.startBackgroundTokenRefresh();
  } else {
    console.log("\x1b[36mBackground token refresh service disabled.\x1b[0m");
  }

  // Show available accounts in a cleaner format
  try {
    // Load all accounts to display them
    const accounts = authManager.loadAllAccounts();
    const accountIds = Array.from(accounts.keys());

    if (accountIds.length > 0) {
      console.log(`\x1b[36mLoaded ${accountIds.length} account(s)\x1b[0m`);
      // Show status of each account
      for (const [accountId, credentials] of accounts.entries()) {
        const isValid = authManager.isTokenValid(credentials);
        // Also check if it would be valid with the background refresh buffer (5 minutes)
        const isRefreshable = authManager.isTokenValid(credentials, 300000); // 5 minutes buffer
        const status = isValid
          ? "✅ Valid"
          : isRefreshable
            ? "🔄 Refreshable"
            : "❌ Invalid/Expired";
        console.log(`\x1b[36m  Account ${accountId}: ${status}\x1b[0m`);
      }
    } else {
      // Check if default account exists
      const { loadCredentials } = require("./services/google-auth");
      const { isTokenValid } = require("./services/auth");
      const defaultCredentials = loadCredentials();
      if (defaultCredentials) {
        const isValid = isTokenValid(defaultCredentials);
        console.log(
          `\x1b[36mDefault account: ${isValid ? "✅ Valid" : "❌ Invalid/Expired"}\x1b[0m`,
        );
      } else {
        console.log(
          "\x1b[36mNo accounts configured. Please authenticate first.\x1b[0m",
        );
      }
    }
  } catch (error) {
    console.log("\x1b[33mWarning: Could not load account information\x1b[0m");
  }
});
