/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const { AuthType, createContentGeneratorConfig, createContentGenerator } = require('@google/gemini-cli-core/dist/src/core/contentGenerator.js');
const { DEFAULT_GEMINI_MODEL } = require('../config/models.js');
const { Config } = require('../config/config.js');

module.exports = {
  AuthType,
  createContentGeneratorConfig,
  createContentGenerator,
  DEFAULT_GEMINI_MODEL,
  Config,
};