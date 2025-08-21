// OAuth Configuration (from Gemini CLI)
const GEMINI_OAUTH_BASE_URL = 'https://accounts.google.com';
const GEMINI_OAUTH_AUTH_ENDPOINT = `${GEMINI_OAUTH_BASE_URL}/o/oauth2/auth`;
const GEMINI_OAUTH_TOKEN_ENDPOINT = `${GEMINI_OAUTH_BASE_URL}/o/oauth2/token`;
const GEMINI_OAUTH_CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
const GEMINI_OAUTH_CLIENT_SECRET = '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';
const GEMINI_OAUTH_SCOPE = 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';

// File System Configuration
const GEMINI_DIR = '.gemini';
const GEMINI_CREDENTIAL_FILENAME = 'oauth_creds.json';
const GEMINI_MULTI_ACCOUNT_PREFIX = 'oauth_creds_';
const GEMINI_MULTI_ACCOUNT_SUFFIX = '.json';

// Token refresh buffer (30 seconds)
const TOKEN_REFRESH_BUFFER_MS = 30 * 1000;

// Background token refresh configuration
const BACKGROUND_TOKEN_REFRESH_INTERVAL = parseInt(process.env.BACKGROUND_TOKEN_REFRESH_INTERVAL) || 3600000; // 1 hour
const BACKGROUND_TOKEN_REFRESH_BUFFER = parseInt(process.env.BACKGROUND_TOKEN_REFRESH_BUFFER) || 300000; // 5 minutes

// API Configuration
const CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com';
const CODE_ASSIST_API_VERSION = 'v1internal';

module.exports = {
  // OAuth Configuration
  GEMINI_OAUTH_BASE_URL,
  GEMINI_OAUTH_AUTH_ENDPOINT,
  GEMINI_OAUTH_TOKEN_ENDPOINT,
  GEMINI_OAUTH_CLIENT_ID,
  GEMINI_OAUTH_CLIENT_SECRET,
  GEMINI_OAUTH_SCOPE,
  
  // File System Configuration
  GEMINI_DIR,
  GEMINI_CREDENTIAL_FILENAME,
  GEMINI_MULTI_ACCOUNT_PREFIX,
  GEMINI_MULTI_ACCOUNT_SUFFIX,
  
  // Token Configuration
  TOKEN_REFRESH_BUFFER_MS,
  BACKGROUND_TOKEN_REFRESH_INTERVAL,
  BACKGROUND_TOKEN_REFRESH_BUFFER,
  
  // API Configuration
  CODE_ASSIST_ENDPOINT,
  CODE_ASSIST_API_VERSION
};