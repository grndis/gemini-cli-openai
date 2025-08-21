const express = require('express');
const { 
  authenticateAccount, 
  listAccounts, 
  removeAccount,
  loadAllAccounts,
  isTokenValid
} = require('../services/auth');
const { loadCredentials } = require('../services/google-auth');

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
    const { generateState } = require('../services/auth');
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
    res.status(500).json({ error: 'Failed to generate authentication URL' });
  }
});

/**
 * OAuth2 callback endpoint
 */
router.get('/callback', async (req, res) => {
  try {
    const { code, error, state } = req.query;
    
    if (error) {
      return res.status(400).json({ 
        error: "OAuth2 authorization failed", 
        details: error 
      });
    }
    
    if (!code) {
      return res.status(400).json({ 
        error: "Missing authorization code" 
      });
    }
    
    // Validate state parameter for CSRF protection
    if (!global.oauthStates || !global.oauthStates.has(state)) {
      return res.status(400).json({ 
        error: "Invalid or expired state parameter" 
      });
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
      return res.status(500).json({ 
        error: "Failed to exchange authorization code for tokens",
        details: errorText
      });
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
      const { saveCredentials } = require('../services/google-auth');
      saveCredentials(credentials, accountId);
    } catch (saveError) {
      console.error('❌ Error saving credentials:', saveError.message);
      return res.status(500).json({ 
        error: "Authentication successful but failed to save credentials",
        details: saveError.message
      });
    }
    
    res.json({
      success: true,
      message: "Authentication successful! Tokens have been saved.",
      account_id: accountId
    });
  } catch (error) {
    console.error("OAuth2 callback error:", error);
    res.status(500).json({ 
      error: "Failed to complete OAuth2 flow",
      details: error.message
    });
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
    res.status(500).json({ error: 'Failed to list accounts' });
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
      res.status(404).json(result);
    }
  } catch (error) {
    console.error('Error removing account:', error);
    res.status(500).json({ error: 'Failed to remove account', details: error.message });
  }
});

module.exports = { authRouter: router };