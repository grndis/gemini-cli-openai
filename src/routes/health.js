const express = require('express');
const { geminiCliModels } = require('../services/gemini');

const router = express.Router();

/**
 * Basic info about the service
 */
router.get('/', (req, res) => {
  const requiresAuth = !!process.env.OPENAI_API_KEY;

  res.json({
    name: 'Gemini CLI OpenAI Worker',
    description: 'OpenAI-compatible API for Google Gemini models via OAuth',
    version: '1.0.0',
    authentication: {
      required: requiresAuth,
      type: requiresAuth ? 'Bearer token in Authorization header' : 'None'
    },
    endpoints: {
      chat_completions: '/v1/chat/completions',
      models: '/v1/models'
    },
    documentation: 'https://github.com/gewoonjaap/gemini-cli-openai'
  });
});

/**
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = { healthRouter: router };