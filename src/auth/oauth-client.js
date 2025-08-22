const fs = require('fs');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');
const { 
  GEMINI_OAUTH_CLIENT_ID, 
  GEMINI_OAUTH_CLIENT_SECRET, 
  GEMINI_OAUTH_SCOPE,
  GEMINI_DIR,
  GEMINI_CREDENTIAL_FILENAME,
  GEMINI_MULTI_ACCOUNT_PREFIX,
  GEMINI_MULTI_ACCOUNT_SUFFIX
} = require('../config');

// Cache for OAuth2 clients
const clientCache = new Map();

/**
 * Get the Gemini directory path
 * @returns {string} Path to the .gemini directory
 */
function getGeminiDir() {
  return path.join(process.env.HOME || process.env.USERPROFILE, GEMINI_DIR);
}

/**
 * Get credential file path for an account
 * @param {string} accountId - Account ID (null for default)
 * @returns {string} Path to the credential file
 */
function getCredentialFilePath(accountId = null) {
  const geminiDir = getGeminiDir();
  let filename;
  
  if (accountId) {
    filename = `${GEMINI_MULTI_ACCOUNT_PREFIX}${accountId}${GEMINI_MULTI_ACCOUNT_SUFFIX}`;
  } else {
    filename = GEMINI_CREDENTIAL_FILENAME;
  }
  
  return path.join(geminiDir, filename);
}

/**
 * Load credentials from file
 * @param {string} accountId - Account ID (null for default)
 * @returns {Object|null} Credentials or null if not found
 */
function loadCredentials(accountId = null) {
  try {
    const credentialsPath = getCredentialFilePath(accountId);
    
    if (!fs.existsSync(credentialsPath)) {
      return null;
    }
    
    const credentialsData = fs.readFileSync(credentialsPath, 'utf8');
    return JSON.parse(credentialsData);
  } catch (error) {
    console.error('Error loading credentials:', error.message);
    return null;
  }
}

/**
 * Save credentials to file
 * @param {Object} credentials - Credentials to save
 * @param {string} accountId - Account ID (null for default)
 */
function saveCredentials(credentials, accountId = null) {
  try {
    const geminiDir = getGeminiDir();
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(geminiDir)) {
      fs.mkdirSync(geminiDir, { recursive: true });
    }
    
    const credentialsPath = getCredentialFilePath(accountId);
    const credString = JSON.stringify(credentials, null, 2);
    fs.writeFileSync(credentialsPath, credString, { mode: 0o600 });
    console.log(`✅ Credentials saved to ${credentialsPath}`);
  } catch (error) {
    console.error('❌ Error saving credentials:', error.message);
  }
}

/**
 * Create and configure OAuth2 client for an account
 * @param {string} accountId - Account ID
 * @returns {OAuth2Client} Configured OAuth2 client
 */
function createOAuth2Client(accountId = null) {
  const clientId = GEMINI_OAUTH_CLIENT_ID;
  const clientSecret = GEMINI_OAUTH_CLIENT_SECRET;
  
  // Create OAuth2 client
  const client = new OAuth2Client(clientId, clientSecret);
  
  // Set up token refresh listener
  client.on('tokens', (tokens) => {
    console.log(`\x1b[36mTokens refreshed for account ${accountId || 'default'}\x1b[0m`);
    
    // Load existing credentials
    const existingCredentials = loadCredentials(accountId) || {};
    
    // Update with new tokens
    const updatedCredentials = {
      ...existingCredentials,
      ...tokens,
      expiry_date: tokens.expiry_date || (tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined)
    };
    
    // Save updated credentials
    saveCredentials(updatedCredentials, accountId);
  });
  
  return client;
}

/**
 * Get OAuth2 client for an account (with caching)
 * @param {string} accountId - Account ID
 * @returns {OAuth2Client} OAuth2 client
 */
function getOAuth2Client(accountId = null) {
  const cacheKey = accountId || 'default';
  
  // Return cached client if available
  if (clientCache.has(cacheKey)) {
    return clientCache.get(cacheKey);
  }
  
  // Create new client
  const client = createOAuth2Client(accountId);
  clientCache.set(cacheKey, client);
  
  return client;
}

/**
 * Initialize authentication for an account
 * @param {string} accountId - Account ID
 * @returns {Promise<string>} Access token
 */
async function initializeAuth(accountId = null) {
  try {
    // Get OAuth2 client
    const client = getOAuth2Client(accountId);
    
    // Load credentials
    const credentials = loadCredentials(accountId);
    if (!credentials) {
      throw new Error(`No credentials found for account ${accountId || 'default'}`);
    }
    
    // Set credentials on client
    client.setCredentials({
      access_token: credentials.access_token,
      refresh_token: credentials.refresh_token,
      token_type: credentials.token_type,
      expiry_date: credentials.expiry_date
    });
    
    // Get access token (this will refresh if needed)
    const accessTokenResponse = await client.getAccessToken();
    return accessTokenResponse.token;
  } catch (error) {
    console.error('Authentication failed:', error.message);
    throw error;
  }
}

/**
 * Load cached credentials and validate them
 * @param {string} accountId - Account ID
 * @returns {Promise<boolean>} True if credentials are valid
 */
async function loadCachedCredentials(accountId = null) {
  try {
    const client = getOAuth2Client(accountId);
    const credentials = loadCredentials(accountId);
    
    if (!credentials) {
      return false;
    }
    
    // Set credentials on client
    client.setCredentials({
      access_token: credentials.access_token,
      refresh_token: credentials.refresh_token,
      token_type: credentials.token_type,
      expiry_date: credentials.expiry_date
    });
    
    // Test if credentials work
    await client.getAccessToken();
    return true;
  } catch (error) {
    console.log(`Cached credentials invalid for account ${accountId || 'default'}: ${error.message}`);
    return false;
  }
}

/**
 * Refresh token for an account
 * @param {string} accountId - Account ID
 * @param {string} refreshToken - Refresh token
 * @returns {Promise<Object>} New credentials
 */
async function refreshAndCacheToken(accountId, refreshToken) {
  try {
    const client = getOAuth2Client(accountId);
    
    // Set refresh token
    client.setCredentials({ refresh_token: refreshToken });
    
    // Refresh token
    const accessTokenResponse = await client.getAccessToken();
    
    // The tokens event listener will automatically save the new credentials
    return {
      access_token: accessTokenResponse.token,
      refresh_token: refreshToken, // Keep the same refresh token
      token_type: 'Bearer',
      expiry_date: Date.now() + 3600 * 1000 // Default 1 hour
    };
  } catch (error) {
    console.error('Token refresh failed:', error.message);
    throw error;
  }
}

module.exports = {
  getOAuth2Client,
  initializeAuth,
  loadCachedCredentials,
  refreshAndCacheToken,
  loadCredentials,
  saveCredentials,
  getGeminiDir
};