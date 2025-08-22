# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Node.js implementation of an OpenAI-compatible API proxy for Google's Gemini models. It allows users to interact with Gemini models using standard OpenAI API endpoints, with support for authentication via Google OAuth2.

## Key Features

- OpenAI-compatible API endpoints for chat completions and model listing
- Multi-account support with automatic token refresh
- Streaming responses with Server-Sent Events
- Multimodal support (text and image inputs)
- Function calling and reasoning support
- Account rotation and load distribution
- Background token refresh service

## Project Structure

```
.
├── index.js              # Main entry point
├── auth.js               # CLI authentication tool
├── package.json          # Dependencies and scripts
├── .env.example          # Environment variable examples
├── src/
│   ├── app.js            # Express app setup
│   ├── config/           # Configuration files
│   ├── routes/           # API route handlers
│   ├── services/         # Core business logic
│   └── utils/            # Utility functions
└── ~/.gemini/            # Default credentials storage location
```

## Common Development Tasks

### Starting the Server
```bash
npm start
# or
npm run dev
```

### Authenticating Accounts
```bash
# Authenticate default account
npm run auth

# Authenticate named account
npm run auth add my-account

# List all accounts
npm run auth list

# Remove an account
npm run auth remove my-account
```

### Environment Variables
Key environment variables (see .env.example for full list):
- `PORT` - Server port (default: 3000)
- `BACKGROUND_TOKEN_REFRESH` - Enable background token refresh
- `RANDOM_ACCOUNT_SELECTION` - Enable random account selection
- `ENABLE_REAL_THINKING` - Enable real Gemini thinking output

## API Endpoints

- `GET /` - Service information
- `GET /health` - Health check
- `GET /v1/models` - List available models
- `POST /v1/chat/completions` - Chat completions (streaming and non-streaming)
- `GET /auth/url` - Generate OAuth2 authentication URL
- `GET /auth/callback` - OAuth2 callback endpoint
- `GET /auth/accounts` - List all authenticated accounts
- `DELETE /auth/accounts/:accountId` - Remove an authenticated account

## Supported Models

- `gemini-2.5-pro` - Most capable model with highest intelligence
- `gemini-2.5-flash` - Fast and efficient model for most tasks
- `gemini-2.5-flash-lite` - Lightweight version of Flash model

## Authentication Flow

1. Generate auth URL: `GET /auth/url`
2. Complete OAuth flow in browser
3. Tokens are automatically saved to `~/.gemini/`
4. Use `X-Gemini-Account-Id` header to specify account for requests

## Credentials Storage

Credentials are stored in `~/.gemini/`:
- `oauth_creds.json` - Default account credentials
- `oauth_creds_{account-id}.json` - Named account credentials