# Gemini CLI OpenAI Node.js Worker

A plain Node.js implementation of the Gemini CLI OpenAI Worker that provides OpenAI-compatible API endpoints for Google's Gemini models via the Gemini CLI OAuth flow.

## 🚀 Enhanced Features

This enhanced version includes additional features for improved account management and reliability:

- ✅ **Multi-Account Support**: Manage multiple Google accounts with automatic rotation
- 🔁 **Auto-Switch Accounts**: Automatically rotate between available accounts
- 🎲 **Random Account Selection**: Enable random account selection for load distribution
- 🔄 **Background Token Refresh**: Automatic token refresh in the background
- 📊 **Request Count Tracking**: Monitor usage per account
- 🛡️ **Improved Reliability**: Better error handling and account fallback

## Features

- ✅ **OpenAI-Compatible API**: Drop-in replacement for OpenAI API endpoints
- 🔐 **Multi-Account Support**: Manage multiple Google accounts with separate credentials
- 🔄 **Automatic Token Refresh**: Handles OAuth2 token refresh automatically
- 📦 **No External Dependencies**: Plain Node.js with minimal dependencies (just Express)
- 🌐 **Streaming Responses**: Full support for streaming responses with Server-Sent Events
- 🖼️ **Multimodal Support**: Support for text and image inputs
- 🛠️ **Function Calling**: Tools/function calling with proper format conversion
- 🤔 **Reasoning Support**: Support for thinking/reasoning features

## Authentication

This implementation supports multiple Google accounts through the Gemini CLI OAuth flow. You can authenticate accounts using either the command-line tool or the web-based OAuth flow.

### Command-Line Authentication

```bash
# Authenticate the default account
npm run auth

# Authenticate a named account
npm run auth add my-account

# List all accounts
npm run auth list

# Remove an account
npm run auth remove my-account
```

### Web-Based Authentication

1. Start the server: `npm start`
2. Visit `http://localhost:3000/auth/url` to get an authentication URL
3. Open the URL in your browser to complete the OAuth flow
4. Tokens will be automatically saved to `~/.gemini/`

### Multi-Account Usage

To use a specific account with API requests, include the `X-Gemini-Account-Id` header:

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Gemini-Account-Id: my-account" \
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

If no account header is provided, the `default` account will be used.

## Setup

1. Clone this repository
2. Install dependencies: `npm install`
3. Authenticate with Google: `npm run auth`
4. Start the server: `npm start`

## API Endpoints

- `GET /` - Basic info about the service
- `GET /health` - Health check endpoint
- `GET /v1/models` - List available models
- `POST /v1/chat/completions` - Chat completions endpoint (streaming and non-streaming)
- `GET /auth/url` - Generate OAuth2 authentication URL
- `GET /auth/callback` - OAuth2 callback endpoint
- `GET /auth/accounts` - List all authenticated accounts
- `DELETE /auth/accounts/:accountId` - Remove an authenticated account

## Environment Variables

- `PORT` - Server port (default: 3000)
- `GEMINI_PROJECT_ID` - Google Cloud project ID (optional)
- `ENABLE_FAKE_THINKING` - Enable fake thinking output (set to "true" to enable)
- `ENABLE_REAL_THINKING` - Enable real Gemini thinking output (set to "true" to enable)
- `STREAM_THINKING_AS_CONTENT` - Stream thinking as content with `<thinking>` tags (set to "true" to enable)
- `BACKGROUND_TOKEN_REFRESH` - Enable background token refresh service (set to "true" to enable)
- `BACKGROUND_TOKEN_REFRESH_INTERVAL` - Background token refresh interval in milliseconds (default: 3600000 - 1 hour)
- `BACKGROUND_TOKEN_REFRESH_BUFFER` - Token refresh buffer time in milliseconds (default: 300000 - 5 minutes)
- `RANDOM_ACCOUNT_SELECTION` - Enable random account selection instead of round-robin (set to "true" to enable)

## Supported Models

- `gemini-2.5-pro` - Most capable model with highest intelligence
- `gemini-2.5-flash` - Fast and efficient model for most tasks
- `gemini-2.5-flash-lite` - Lightweight version of Flash model

## File Structure

Credentials are stored in `~/.gemini/`:

- `oauth_creds.json` - Default account credentials
- `oauth_creds_{account-id}.json` - Named account credentials

## Usage with OpenAI-Compatible Clients

Point your OpenAI-compatible client to `http://localhost:3000/v1` and use any of the supported models.