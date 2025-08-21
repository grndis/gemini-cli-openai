/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

class Config {
  constructor() {
    this.model = null;
    this.proxy = null;
    this.loggingEnabled = false;
    this.usageStatisticsEnabled = false;
  }

  getModel() {
    return this.model;
  }

  setModel(model) {
    this.model = model;
  }

  getProxy() {
    return this.proxy;
  }

  setProxy(proxy) {
    this.proxy = proxy;
  }

  getLoggingEnabled() {
    return this.loggingEnabled;
  }

  setLoggingEnabled(enabled) {
    this.loggingEnabled = enabled;
  }

  getUsageStatisticsEnabled() {
    return this.usageStatisticsEnabled;
  }

  setUsageStatisticsEnabled(enabled) {
    this.usageStatisticsEnabled = enabled;
  }

  flashFallbackHandler() {
    // Default implementation
    return false;
  }
}

module.exports = {
  Config,
};