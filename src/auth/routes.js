const express = require('express');
const { 
  authenticateAccount, 
  listAccounts, 
  removeAccount,
  loadAllAccounts,
  isTokenValid
} = require('./manager');
const { loadCredentials } = require('./oauth-client');
const { sendInternalServerError, sendBadRequest, sendNotFound } = require('../utils/errorHandler');

const router = express.Router();

/**
 * Generate OAuth2 authentication URL
 */
router.get('/url', (req, res) => {
  try {
    const accountId = req.query.account_id || 'default';
    const host = req.get('host');
    const isLocalhost = host && (host.startsWith('localhost') || host.startsWith('127.0.0.1'));
    const protocol = isLocalhost ? 'http' : 'https';
    const baseUrl = `${protocol}://${host}`;
    const redirectUri = `${baseUrl}/auth/callback`;
    
    // Import generateState from auth service
    const { generateState } = require('./manager');
    const state = generateState();
    
    // Import config constants
    const { 
      GEMINI_OAUTH_AUTH_ENDPOINT, 
      GEMINI_OAUTH_CLIENT_ID, 
      GEMINI_OAUTH_SCOPE 
    } = require('../config');
    
    const authUrl = new URL(GEMINI_OAUTH_AUTH_ENDPOINT);
    authUrl.searchParams.append('client_id', GEMINI_OAUTH_CLIENT_ID);
    authUrl.searchParams.append('redirect_uri', redirectUri);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('scope', GEMINI_OAUTH_SCOPE);
    authUrl.searchParams.append('access_type', 'offline');
    authUrl.searchParams.append('prompt', 'consent');
    authUrl.searchParams.append('state', state);
    
    // Store the state in memory for validation (in production, use a proper store)
    if (!global.oauthStates) {
      global.oauthStates = new Map();
    }
    global.oauthStates.set(state, { accountId, timestamp: Date.now() });
    
    // Clean up old states (older than 5 minutes)
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    for (const [key, value] of global.oauthStates.entries()) {
      if (value.timestamp < fiveMinutesAgo) {
        global.oauthStates.delete(key);
      }
    }
    
    res.json({
      auth_url: authUrl.toString(),
      redirect_uri: redirectUri,
      account_id: accountId,
      message: "Open the following URL in your browser to authenticate with Google:"
    });
  } catch (error) {
    console.error('Error generating auth URL:', error);
    sendInternalServerError(res, 'Failed to generate authentication URL', null, error);
  }
});

/**
 * OAuth2 callback endpoint
 */
router.get('/callback', async (req, res) => {
  try {
    const { code, error, state } = req.query;
    
    if (error) {
      return sendBadRequest(res, "OAuth2 authorization failed", error);
    }
    
    if (!code) {
      return sendBadRequest(res, "Missing authorization code");
    }
    
    // Validate state parameter for CSRF protection
    if (!global.oauthStates || !global.oauthStates.has(state)) {
      return sendBadRequest(res, "Invalid or expired state parameter");
    }
    
    const stateData = global.oauthStates.get(state);
    const accountId = stateData.accountId;
    
    // Clean up the state
    global.oauthStates.delete(state);
    
    // Construct redirect URI
    const host = req.get('host');
    const isLocalhost = host && (host.startsWith('localhost') || host.startsWith('127.0.0.1'));
    const protocol = isLocalhost ? 'http' : 'https';
    const redirectUri = `${protocol}://${host}/auth/callback`;
    
    // Import config constants
    const { 
      GEMINI_OAUTH_TOKEN_ENDPOINT, 
      GEMINI_OAUTH_CLIENT_ID, 
      GEMINI_OAUTH_CLIENT_SECRET 
    } = require('../config');
    
    // Exchange authorization code for tokens
    const bodyData = new URLSearchParams({
      client_id: GEMINI_OAUTH_CLIENT_ID,
      client_secret: GEMINI_OAUTH_CLIENT_SECRET,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });

    const tokenResponse = await fetch(GEMINI_OAUTH_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: bodyData,
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Token exchange failed:", errorText);
      return sendInternalServerError(res, "Failed to exchange authorization code for tokens", errorText);
    }

    const tokenData = await tokenResponse.json();
    
    // Calculate expiry date
    const expiryDate = Date.now() + (tokenData.expires_in * 1000);
    
    // Prepare credentials object
    const credentials = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      scope: tokenData.scope,
      token_type: tokenData.token_type,
      id_token: tokenData.id_token,
      expiry_date: expiryDate
    };
    
    // Save credentials to file
    try {
      const { saveCredentials } = require('./oauth-client');
      saveCredentials(credentials, accountId);
    } catch (saveError) {
      console.error('❌ Error saving credentials:', saveError.message);
      return sendInternalServerError(res, "Authentication successful but failed to save credentials", saveError.message, saveError);
    }
    
    res.json({
      success: true,
      message: "Authentication successful! Tokens have been saved.",
      account_id: accountId
    });
  } catch (error) {
    console.error("OAuth2 callback error:", error);
    sendInternalServerError(res, "Failed to complete OAuth2 flow", error.message, error);
  }
});

/**
 * List all accounts
 */
router.get('/accounts', (req, res) => {
  try {
    const accounts = listAccounts();
    res.json({ accounts });
  } catch (error) {
    console.error('Error listing accounts:', error);
    sendInternalServerError(res, 'Failed to list accounts', null, error);
  }
});

/**
 * Remove an account
 */
router.delete('/accounts/:accountId', (req, res) => {
  try {
    const accountId = req.params.accountId;
    const result = removeAccount(accountId);
    if (result.success) {
      res.json(result);
    } else {
      sendNotFound(res, result.error);
    }
  } catch (error) {
    console.error('Error removing account:', error);
    sendInternalServerError(res, 'Failed to remove account', error.message, error);
  }
});

module.exports = { authRouter: router };