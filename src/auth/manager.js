const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const url = require("url");
const {
	GEMINI_DIR,
	GEMINI_CREDENTIAL_FILENAME,
	GEMINI_MULTI_ACCOUNT_PREFIX,
	GEMINI_MULTI_ACCOUNT_SUFFIX,
	GEMINI_OAUTH_AUTH_ENDPOINT,
	GEMINI_OAUTH_TOKEN_ENDPOINT,
	GEMINI_OAUTH_CLIENT_ID,
	GEMINI_OAUTH_CLIENT_SECRET,
	GEMINI_OAUTH_SCOPE,
	TOKEN_REFRESH_BUFFER_MS,
} = require("../config");

// Configuration for background token refresh
const BACKGROUND_TOKEN_REFRESH_INTERVAL =
	parseInt(process.env.BACKGROUND_TOKEN_REFRESH_INTERVAL) || 3600000; // 1 hour
const BACKGROUND_TOKEN_REFRESH_BUFFER =
	parseInt(process.env.BACKGROUND_TOKEN_REFRESH_BUFFER) || 300000; // 5 minutes
const RANDOM_ACCOUNT_SELECTION =
	process.env.RANDOM_ACCOUNT_SELECTION === "true";

/**
 * Class to manage Gemini accounts with background token refresh and account rotation
 */
class GeminiAuthManager {
	constructor() {
		this.accounts = new Map(); // Cache of loaded accounts
		this.currentAccountIndex = 0; // For round-robin account selection
		this.backgroundRefreshIntervalId = null; // For background token refresh service
		this.requestCount = new Map(); // Track requests per account
		this.lastResetDate = new Date().toISOString().split("T")[0]; // Track last reset date (UTC)
		this.requestCountFile = path.join(getGeminiDir(), "request_counts.json");
		this.loadRequestCounts();
	}

	/**
	 * Load request counts from disk
	 */
	async loadRequestCounts() {
		try {
			if (fs.existsSync(this.requestCountFile)) {
				const data = fs.readFileSync(this.requestCountFile, "utf8");
				const counts = JSON.parse(data);

				// Restore last reset date
				if (counts.lastResetDate) {
					this.lastResetDate = counts.lastResetDate;
				}

				// Restore request counts
				if (counts.requests) {
					for (const [accountId, count] of Object.entries(counts.requests)) {
						this.requestCount.set(accountId, count);
					}
				}

				// Reset counts if we've crossed into a new UTC day
				this.resetRequestCountsIfNeeded();
			}
		} catch (error) {
			// File doesn't exist or is invalid, start with empty counts
			this.resetRequestCountsIfNeeded();
		}
	}

	/**
	 * Save request counts to disk
	 */
	async saveRequestCounts() {
		try {
			const counts = {
				lastResetDate: this.lastResetDate,
				requests: Object.fromEntries(this.requestCount),
			};
			// Create directory if it doesn't exist
			const dir = path.dirname(this.requestCountFile);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}
			fs.writeFileSync(this.requestCountFile, JSON.stringify(counts, null, 2));
		} catch (error) {
			console.warn("Failed to save request counts:", error.message);
		}
	}

	/**
	 * Reset request counts if we've crossed into a new UTC day
	 */
	resetRequestCountsIfNeeded() {
		const today = new Date().toISOString().split("T")[0];
		if (today !== this.lastResetDate) {
			this.requestCount.clear();
			this.lastResetDate = today;
			console.log("Request counts reset for new UTC day");
			this.saveRequestCounts();
		}
	}

	/**
	 * Increment request count for an account
	 * @param {string} accountId - The account ID
	 */
	async incrementRequestCount(accountId) {
		this.resetRequestCountsIfNeeded();
		const currentCount = this.requestCount.get(accountId) || 0;
		this.requestCount.set(accountId, currentCount + 1);
		await this.saveRequestCounts();
	}

	/**
	 * Get request count for an account
	 * @param {string} accountId - The account ID
	 * @returns {number} The request count
	 */
	getRequestCount(accountId) {
		this.resetRequestCountsIfNeeded();
		return this.requestCount.get(accountId) || 0;
	}

	/**
	 * Start background token refresh service
	 */
	startBackgroundTokenRefresh() {
		// Clear any existing interval
		if (this.backgroundRefreshIntervalId) {
			clearInterval(this.backgroundRefreshIntervalId);
		}

		// Set up periodic token refresh
		this.backgroundRefreshIntervalId = setInterval(async () => {
			try {
				await this.refreshAllTokens();
			} catch (error) {
				console.error(
					"\x1b[31m%s\x1b[0m",
					"Error in background token refresh:",
					error.message,
				);
			}
		}, BACKGROUND_TOKEN_REFRESH_INTERVAL);

		console.log(
			"\x1b[32m%s\x1b[0m",
			"Background token refresh service started",
		);
	}

	/**
	 * Stop background token refresh service
	 */
	stopBackgroundTokenRefresh() {
		if (this.backgroundRefreshIntervalId) {
			clearInterval(this.backgroundRefreshIntervalId);
			this.backgroundRefreshIntervalId = null;
			console.log(
				"\x1b[32m%s\x1b[0m",
				"Background token refresh service stopped",
			);
		}
	}

	/**
	 * Refresh all account tokens
	 */
	async refreshAllTokens() {
		console.log(
			"\x1b[36m%s\x1b[0m",
			"Starting background token refresh for all accounts...",
		);

		// Load all accounts
		const accounts = loadAllAccounts();
		const accountIds = Array.from(accounts.keys());

		// Refresh default account if it exists
		try {
			const { loadCredentials } = require("./oauth-client");
			const defaultCredentials = loadCredentials();
			if (defaultCredentials) {
				// Check if token needs refresh (within buffer time)
				if (
					!isTokenValid(defaultCredentials, BACKGROUND_TOKEN_REFRESH_BUFFER)
				) {
					console.log(
						"\x1b[33m%s\x1b[0m",
						"Refreshing default account token...",
					);
					const { refreshAndCacheToken } = require("../services/gemini");
					const newCredentials = await refreshAndCacheToken(
						"default",
						defaultCredentials.refresh_token,
					);
					if (newCredentials) {
						console.log(
							"\x1b[32m%s\x1b[0m",
							"Default account token refreshed successfully",
						);
					} else {
						console.log(
							"\x1b[31m%s\x1b[0m",
							"Failed to refresh default account token",
						);
					}
				} else {
					console.log(
						"\x1b[32m%s\x1b[0m",
						"Default account token is still valid",
					);
				}
			}
		} catch (error) {
			console.error(
				"\x1b[31m%s\x1b[0m",
				"Error refreshing default account token:",
				error.message,
			);
		}

		// Refresh all multi-account tokens
		for (const accountId of accountIds) {
			try {
				const { loadCredentials } = require("./oauth-client");
				const credentials = loadCredentials(accountId);
				if (credentials) {
					// Check if token needs refresh (within buffer time)
					if (!isTokenValid(credentials, BACKGROUND_TOKEN_REFRESH_BUFFER)) {
						console.log(
							`\x1b[33mRefreshing account ${accountId} token...\x1b[0m`,
						);
						const { refreshAndCacheToken } = require("../services/gemini");
						const newCredentials = await refreshAndCacheToken(
							accountId,
							credentials.refresh_token,
						);
						if (newCredentials) {
							console.log(
								`\x1b[32mAccount ${accountId} token refreshed successfully\x1b[0m`,
							);
						} else {
							console.log(
								`\x1b[31mFailed to refresh account ${accountId} token\x1b[0m`,
							);
						}
					} else {
						console.log(
							`\x1b[32mAccount ${accountId} token is still valid\x1b[0m`,
						);
					}
				}
			} catch (error) {
				console.error(
					`\x1b[31mError refreshing account ${accountId} token:\x1b[0m`,
					error.message,
				);
			}
		}

		console.log("\x1b[36m%s\x1b[0m", "Background token refresh completed");
	}

	/**
	 * Get the next available account for rotation
	 * @returns {Object|null} Object with {accountId, credentials} or null if no accounts available
	 */
	async getNextAccount() {
		// Load all accounts if not already loaded
		if (this.accounts.size === 0) {
			this.accounts = loadAllAccounts();
		}

		const accountIds = Array.from(this.accounts.keys());

		if (accountIds.length === 0) {
			return null;
		}

		// Try up to all accounts to find a valid one
		const maxAttempts = accountIds.length;
		let attempts = 0;

		while (attempts < maxAttempts) {
			// Use random or round-robin selection
			let accountId;
			if (RANDOM_ACCOUNT_SELECTION) {
				// Select a random account
				accountId = accountIds[Math.floor(Math.random() * accountIds.length)];
			} else {
				// Use round-robin selection
				accountId = accountIds[this.currentAccountIndex];
				// Update index for next call
				this.currentAccountIndex =
					(this.currentAccountIndex + 1) % accountIds.length;
			}

			const { loadCredentials } = require("./oauth-client");
			const credentials = loadCredentials(accountId);

			// Check if the account is valid
			if (credentials && this.isTokenValid(credentials)) {
				console.log(
					`\x1b[36mRandom account selection enabled. Selected account: ${accountId}\x1b[0m`,
				);
				// Show which account we're using
				console.log(
					`\x1b[36mUsing account ${accountId} (Request #${this.getRequestCount(accountId) + 1} today)\x1b[0m`,
				);
				return { accountId, credentials };
			}

			attempts++;
			if (
				process.env.NODE_ENV !== "production" &&
				process.env.DEBUG_AUTH === "true"
			) {
				console.log(`\x1b[33mSkipping invalid account: ${accountId}\x1b[0m`);
			}
		}

		// If we get here, no valid accounts were found based on token validity
		// But let's try one more time with any account, as tokens might be refreshable
		if (accountIds.length > 0) {
			const accountId = RANDOM_ACCOUNT_SELECTION
				? accountIds[Math.floor(Math.random() * accountIds.length)]
				: accountIds[this.currentAccountIndex];

			// Reset index for next call
			if (!RANDOM_ACCOUNT_SELECTION) {
				this.currentAccountIndex =
					(this.currentAccountIndex + 1) % accountIds.length;
			}

			const { loadCredentials } = require("./oauth-client");
			const credentials = loadCredentials(accountId);
			console.log(
				`\x1b[36mRandom account selection enabled. Selected account: ${accountId}\x1b[0m`,
			);
			// Show which account we're using
			console.log(
				`\x1b[36mUsing account ${accountId} (Request #${this.getRequestCount(accountId) + 1} today)\x1b[0m`,
			);
			return { accountId, credentials };
		}

		// If we get here, no accounts were found at all
		console.log("\x1b[31mNo valid accounts available for request\x1b[0m");
		return null;
	}

	/**
	 * Peek at the next account without consuming it
	 * @returns {Object|null} Object with {accountId, credentials} or null if no accounts available
	 */
	peekNextAccount() {
		// Load all accounts if not already loaded
		if (this.accounts.size === 0) {
			this.accounts = loadAllAccounts();
		}

		const accountIds = Array.from(this.accounts.keys());

		if (accountIds.length === 0) {
			return null;
		}

		// Try up to all accounts to find a valid one
		const maxAttempts = accountIds.length;
		let attempts = 0;

		while (attempts < maxAttempts) {
			// Use random or round-robin selection without updating index
			let accountId;
			if (RANDOM_ACCOUNT_SELECTION) {
				// Select a random account
				accountId = accountIds[Math.floor(Math.random() * accountIds.length)];
			} else {
				// Use round-robin selection
				accountId = accountIds[this.currentAccountIndex];
			}

			const { loadCredentials } = require("./oauth-client");
			const credentials = loadCredentials(accountId);

			// Check if the account is valid
			if (credentials && this.isTokenValid(credentials)) {
				return { accountId, credentials };
			}

			attempts++;
		}

		// If we get here, no valid accounts were found based on token validity
		// But let's try one more time with any account, as tokens might be refreshable
		if (accountIds.length > 0) {
			const accountId = RANDOM_ACCOUNT_SELECTION
				? accountIds[Math.floor(Math.random() * accountIds.length)]
				: accountIds[this.currentAccountIndex];

			const { loadCredentials } = require("./oauth-client");
			const credentials = loadCredentials(accountId);
			return { accountId, credentials };
		}

		// If we get here, no accounts were found at all
		return null;
	}

	/**
	 * Test if an account can make API calls
	 * @param {string} accountId - The account ID
	 * @returns {Promise<boolean>} True if the account can make API calls
	 */
	async testAccount(accountId) {
		try {
			// Import required functions
			const { initializeAuth, discoverProjectId } = require("../services/gemini");

			// Get access token for the account
			const accessToken = await initializeAuth(accountId);
			if (!accessToken) {
				return false;
			}

			// Try to discover project ID (this tests if the token works)
			const projectId = await discoverProjectId(accessToken);

			// If we get here, the account is working
			return true;
		} catch (error) {
			// If there's an error, the account is not working
			// But we need to distinguish between token errors and API permission errors
			if (
				process.env.NODE_ENV !== "production" &&
				process.env.DEBUG_AUTH === "true"
			) {
				console.log(
					`\x1b[33mAccount ${accountId} test failed: ${error.message}\x1b[0m`,
				);
			}
			return false;
		}
	}

	/**
	 * Load all accounts
	 * @returns {Map} Map of account IDs to credentials
	 */
	loadAllAccounts() {
		this.accounts = loadAllAccounts();
		return this.accounts;
	}

	/**
	 * Check if a token is valid
	 * @param {Object} credentials - The credentials to check
	 * @param {number} bufferMs - Buffer time in milliseconds
	 * @returns {boolean} - True if token is valid
	 */
	isTokenValid(credentials, bufferMs = TOKEN_REFRESH_BUFFER_MS) {
		return isTokenValid(credentials, bufferMs);
	}
}

// Create a singleton instance
const authManager = new GeminiAuthManager();

/**
 * Get the Gemini directory path
 * @returns {string} Path to the .gemini directory
 */
function getGeminiDir() {
	return path.join(process.env.HOME || process.env.USERPROFILE, GEMINI_DIR);
}

/**
 * Load credentials from file
 * @param {string} accountId - Account ID (null for default)
 * @returns {Object|null} Credentials or null if not found
 */

/**
 * Check if a token is valid
 * @param {Object} credentials - The credentials to check
 * @param {number} bufferMs - Buffer time in milliseconds
 * @returns {boolean} - True if token is valid
 */
function isTokenValid(credentials, bufferMs = TOKEN_REFRESH_BUFFER_MS) {
	if (!credentials || !credentials.expiry_date) {
		// Add debugging for invalid credentials
		if (
			process.env.NODE_ENV !== "production" &&
			process.env.DEBUG_AUTH === "true"
		) {
			console.log(
				"\x1b[33mDebug: Invalid credentials structure\x1b[0m",
				credentials,
			);
		}
		return false;
	}

	const now = Date.now();
	const isValid = now < credentials.expiry_date - bufferMs;

	// Add debugging for token validation
	if (
		process.env.NODE_ENV !== "production" &&
		process.env.DEBUG_AUTH === "true"
	) {
		console.log("\x1b[33mDebug: Token validation\x1b[0m", {
			now: new Date(now).toISOString(),
			expiry: new Date(credentials.expiry_date).toISOString(),
			bufferMs,
			isValid,
		});
	}

	return isValid;
}

/**
 * Generate a random state parameter for CSRF protection
 * @returns {string} Random state string
 */
function generateState() {
	return crypto.randomBytes(16).toString("hex");
}

/**
 * Find an available port
 * @returns {Promise<number>} Available port number
 */
function findAvailablePort() {
	return new Promise((resolve, reject) => {
		const server = http.createServer();
		server.listen(0, () => {
			const port = server.address().port;
			server.close(() => resolve(port));
		});
		server.on("error", reject);
	});
}

/**
 * Start local server to handle OAuth2 callback
 * @param {number} port - Port to listen on
 * @param {string} state - State parameter for CSRF protection
 * @returns {Promise<Object>} Server and promise for handling the callback
 */
function startCallbackServer(port, state) {
	let resolveCallback;
	let rejectCallback;

	const callbackPromise = new Promise((resolve, reject) => {
		resolveCallback = resolve;
		rejectCallback = reject;
	});

	const server = http.createServer((req, res) => {
		const parsedUrl = url.parse(req.url, true);
		const { query } = parsedUrl;

		if (parsedUrl.pathname === "/oauth2callback") {
			// Check state parameter for CSRF protection
			if (query.state !== state) {
				res.writeHead(400, { "Content-Type": "text/html" });
				res.end(
					"<h1>Error: Invalid state parameter</h1><p>The authentication request could not be verified.</p>",
				);
				rejectCallback(new Error("Invalid state parameter"));
				return;
			}

			// Check for error parameter
			if (query.error) {
				res.writeHead(400, { "Content-Type": "text/html" });
				res.end(
					`<h1>Authentication Error</h1><p>${query.error}: ${query.error_description || "No details provided"}</p>`,
				);
				rejectCallback(
					new Error(
						`${query.error}: ${query.error_description || "No details provided"}`,
					),
				);
				return;
			}

			// Check for authorization code
			if (!query.code) {
				res.writeHead(400, { "Content-Type": "text/html" });
				res.end(
					"<h1>Error: Missing authorization code</h1><p>The authentication response is missing the required authorization code.</p>",
				);
				rejectCallback(new Error("Missing authorization code"));
				return;
			}

			// Send success response to user
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Authentication Successful</title>
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
              .success { color: #28a745; }
            </style>
          </head>
          <body>
            <h1 class="success">Authentication Successful!</h1>
            <p>Your credentials have been saved.</p>
            <p>You can close this window and return to the terminal.</p>
            <script>
              setTimeout(function() {
                window.close();
              }, 3000);
            </script>
          </body>
        </html>
      `);

			// Resolve the promise with the authorization code
			resolveCallback(query.code);
		} else {
			res.writeHead(404, { "Content-Type": "text/html" });
			res.end("<h1>Not Found</h1><p>The requested resource was not found.</p>");
		}
	});

	server.listen(port, () => {
		console.log(
			`📡 Local server listening on port ${port} for OAuth2 callback`,
		);
	});

	// Handle server errors
	server.on("error", (error) => {
		rejectCallback(new Error(`Failed to start local server: ${error.message}`));
	});

	return { server, callbackPromise };
}

/**
 * Exchange authorization code for tokens
 * @param {string} code - Authorization code
 * @param {number} port - Port used for redirect URI
 * @returns {Promise<Object>} Tokens
 */
async function exchangeCodeForTokens(code, port) {
	const redirectUri = `http://localhost:${port}/oauth2callback`;

	const bodyData = new URLSearchParams({
		client_id: GEMINI_OAUTH_CLIENT_ID,
		client_secret: GEMINI_OAUTH_CLIENT_SECRET,
		code: code,
		grant_type: "authorization_code",
		redirect_uri: redirectUri,
	});

	try {
		const response = await fetch(GEMINI_OAUTH_TOKEN_ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: bodyData,
		});

		if (!response.ok) {
			const errorData = await response.text();
			throw new Error(
				`Token exchange failed: ${response.status} ${response.statusText}. Response: ${errorData}`,
			);
		}

		const tokenData = await response.json();

		// Convert to OAuth2Credentials format
		const credentials = {
			access_token: tokenData.access_token,
			refresh_token: tokenData.refresh_token || undefined,
			token_type: tokenData.token_type,
			scope: tokenData.scope,
			id_token: tokenData.id_token,
			expiry_date: tokenData.expires_in
				? Date.now() + tokenData.expires_in * 1000
				: undefined,
		};

		return credentials;
	} catch (error) {
		console.error("Token exchange failed:", error.message);
		throw error;
	}
}

/**
 * Load all accounts
 * @returns {Map} Map of account IDs to credentials
 */
function loadAllAccounts() {
	const accounts = new Map();

	try {
		const geminiDir = getGeminiDir();

		// Check if directory exists
		if (!fs.existsSync(geminiDir)) {
			if (
				process.env.NODE_ENV !== "production" &&
				process.env.DEBUG_AUTH === "true"
			) {
				console.log(
					"\x1b[33mDebug: Gemini directory does not exist\x1b[0m",
					geminiDir,
				);
			}
			return accounts;
		}

		// Read directory to find all credential files
		const files = fs.readdirSync(geminiDir);

		if (
			process.env.NODE_ENV !== "production" &&
			process.env.DEBUG_AUTH === "true"
		) {
			console.log(
				"\x1b[33mDebug: Found files in Gemini directory\x1b[0m",
				files,
			);
		}

		// Filter for credential files
		const credentialFiles = files.filter(
			(file) =>
				file === GEMINI_CREDENTIAL_FILENAME ||
				(file.startsWith(GEMINI_MULTI_ACCOUNT_PREFIX) &&
					file.endsWith(GEMINI_MULTI_ACCOUNT_SUFFIX)),
		);

		if (
			process.env.NODE_ENV !== "production" &&
			process.env.DEBUG_AUTH === "true"
		) {
			console.log(
				"\x1b[33mDebug: Credential files found\x1b[0m",
				credentialFiles,
			);
		}

		// Load each account
		for (const file of credentialFiles) {
			try {
				const accountPath = path.join(geminiDir, file);
				const credentialsData = fs.readFileSync(accountPath, "utf8");
				const credentials = JSON.parse(credentialsData);

				// Extract account ID from filename
				let accountId;
				if (file === GEMINI_CREDENTIAL_FILENAME) {
					accountId = "default";
				} else {
					accountId = file.substring(
						GEMINI_MULTI_ACCOUNT_PREFIX.length,
						file.length - GEMINI_MULTI_ACCOUNT_SUFFIX.length,
					);
				}

				accounts.set(accountId, credentials);

				if (
					process.env.NODE_ENV !== "production" &&
					process.env.DEBUG_AUTH === "true"
				) {
					console.log(`\x1b[33mDebug: Loaded account ${accountId}\x1b[0m`);
				}
			} catch (error) {
				console.warn(`⚠️ Failed to load account from ${file}:`, error.message);
			}
		}

		if (
			process.env.NODE_ENV !== "production" &&
			process.env.DEBUG_AUTH === "true"
		) {
			console.log("\x1b[33mDebug: Total accounts loaded\x1b[0m", accounts.size);
		}

		return accounts;
	} catch (error) {
		console.warn("⚠️ Failed to load multi-account credentials:", error.message);
		return accounts;
	}
}

/**
 * Remove an account
 * @param {string} accountId - Account ID
 */
function removeAccount(accountId) {
	try {
		const geminiDir = getGeminiDir();
		let accountPath;

		if (accountId === "default") {
			accountPath = path.join(geminiDir, GEMINI_CREDENTIAL_FILENAME);
		} else {
			const accountFilename = `${GEMINI_MULTI_ACCOUNT_PREFIX}${accountId}${GEMINI_MULTI_ACCOUNT_SUFFIX}`;
			accountPath = path.join(geminiDir, accountFilename);
		}

		// Remove file
		if (fs.existsSync(accountPath)) {
			fs.unlinkSync(accountPath);
			return {
				success: true,
				message: `Account ${accountId} removed successfully`,
			};
		} else {
			return { success: false, error: `Account ${accountId} not found` };
		}
	} catch (error) {
		console.error("Error removing account:", error);
		return {
			success: false,
			error: `Failed to remove account: ${error.message}`,
		};
	}
}

module.exports = {
	getGeminiDir,
	isTokenValid,
	generateState,
	findAvailablePort,
	startCallbackServer,
	exchangeCodeForTokens,
	loadAllAccounts,
	removeAccount,
	authenticateAccount: async function (accountId) {
		console.log(
			`➕ Authenticating new Gemini account with ID: ${accountId}...`,
		);

		try {
			// Find an available port
			const port = await findAvailablePort();

			// Generate state parameter for CSRF protection
			const state = generateState();

			// Start local server to handle OAuth2 callback
			const { server, callbackPromise } = startCallbackServer(port, state);

			// Generate authorization URL
			const redirectUri = `http://localhost:${port}/oauth2callback`;
			const authUrl = new URL(GEMINI_OAUTH_AUTH_ENDPOINT);
			authUrl.searchParams.append("client_id", GEMINI_OAUTH_CLIENT_ID);
			authUrl.searchParams.append("redirect_uri", redirectUri);
			authUrl.searchParams.append("response_type", "code");
			authUrl.searchParams.append("scope", GEMINI_OAUTH_SCOPE);
			authUrl.searchParams.append("access_type", "offline");
			authUrl.searchParams.append("prompt", "consent");
			authUrl.searchParams.append("state", state);

			const authUrlString = authUrl.toString();

			// Display authorization URL
			console.log("\n=== Gemini OAuth Authorization ===");
			console.log("Please visit the following URL to authenticate:");
			console.log(`\n${authUrlString}\n`);

			console.log("(Press Ctrl+C to cancel)");

			// Try to open the URL in the browser
			try {
				const open = (await import("open")).default;
				await open(authUrlString);
				console.log(
					"\n🌐 Browser opened automatically. If not, please visit the URL above.",
				);
			} catch (openError) {
				console.log(
					"\nPlease visit the URL above in your browser to authenticate.",
				);
			}

			// Wait for authorization code from callback
			console.log("\n⏳ Waiting for authentication...");
			const code = await callbackPromise;

			// Stop the server
			server.close();

			// Exchange code for tokens
			console.log("\n🔄 Exchanging authorization code for tokens...");
			const credentials = await exchangeCodeForTokens(code, port);

			// Save credentials
			const { saveCredentials } = require("./oauth-client");
			saveCredentials(credentials, accountId);

			console.log(`\n🎉 Authentication successful for account ${accountId}!`);
			if (accountId === "default") {
				console.log(
					`Access token saved to ~/.gemini/${GEMINI_CREDENTIAL_FILENAME}`,
				);
			} else {
				console.log(
					`Access token saved to ~/.gemini/${GEMINI_MULTI_ACCOUNT_PREFIX}${accountId}${GEMINI_MULTI_ACCOUNT_SUFFIX}`,
				);
			}
		} catch (error) {
			console.error("Authentication failed:", error.message);
			process.exit(1);
		}
	},
	listAccounts: function () {
		console.log("\nListing all accounts...\n");

		try {
			const accounts = loadAllAccounts();
			const accountList = [];
			const accountIds = Array.from(accounts.keys());

			console.log(`Found ${accountIds.length} account(s):\n`);

			for (const [accountId, credentials] of accounts.entries()) {
				const isValid = isTokenValid(credentials);
				const expiryDate = credentials.expiry_date
					? new Date(credentials.expiry_date)
					: null;

				console.log(`Account ID: ${accountId}`);
				console.log(`  Status: ${isValid ? "✅ Valid" : "❌ Invalid/Expired"}`);
				if (expiryDate) {
					console.log(`  Expires: ${expiryDate.toLocaleString()}`);
				}
				console.log("");

				accountList.push({
					account_id: accountId,
					status: isValid ? "valid" : "invalid/expired",
					expires_at: expiryDate ? expiryDate.toISOString() : null,
					time_until_expiry_seconds: credentials.expiry_date
						? Math.floor((credentials.expiry_date - Date.now()) / 1000)
						: null,
				});
			}

			return accountList;
		} catch (error) {
			console.error("Error listing accounts:", error);
			return [];
		}
	},
	// Export the auth manager instance and helper functions
	authManager,
	loadAllAccounts,
};
