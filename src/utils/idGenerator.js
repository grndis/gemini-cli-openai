/**
 * Generate a random ID with a prefix
 * @param {string} prefix - Prefix for the ID
 * @param {number} length - Length of the random part (default: 9)
 * @returns {string} Generated ID
 */
function generateId(prefix, length = 9) {
  return `${prefix}${Math.random().toString(36).substr(2, length)}`;
}

/**
 * Generate a chat completion ID
 * @returns {string} Chat completion ID
 */
function generateChatId() {
  return generateId('chatcmpl-', 9);
}

/**
 * Generate a tool call ID
 * @returns {string} Tool call ID
 */
function generateToolCallId() {
  return generateId('call_', 9);
}

/**
 * Get current Unix timestamp in seconds
 * @returns {number} Current timestamp in seconds
 */
function getCurrentTimestamp() {
  return Math.floor(Date.now() / 1000);
}

module.exports = {
  generateId,
  generateChatId,
  generateToolCallId,
  getCurrentTimestamp
};