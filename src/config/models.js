/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Default model to use when none is specified
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

// Available models with their properties
const GEMINI_MODELS = {
  'gemini-2.5-pro': {
    maxTokens: 65536,
    contextWindow: 1048576,
    supportsImages: true,
    supportsPromptCache: false,
    inputPrice: 0,
    outputPrice: 0,
    description: "Google's Gemini 2.5 Pro model via OAuth (free tier)",
    thinking: true
  },
  'gemini-2.5-flash': {
    maxTokens: 65536,
    contextWindow: 1048576,
    supportsImages: true,
    supportsPromptCache: false,
    inputPrice: 0,
    outputPrice: 0,
    description: "Google's Gemini 2.5 Flash model via OAuth (free tier)",
    thinking: true
  },
  'gemini-2.5-flash-lite': {
    maxTokens: 65536,
    contextWindow: 1048576,
    supportsImages: true,
    supportsPromptCache: false,
    inputPrice: 0,
    outputPrice: 0,
    description: "Google's Gemini 2.5 Flash Lite model via OAuth (free tier)",
    thinking: true
  }
};

module.exports = {
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODELS,
};