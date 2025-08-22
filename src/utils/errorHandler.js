/**
 * Centralized error handling utilities for the application
 */

/**
 * Send a bad request error response
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 * @param {Object} details - Additional error details (optional)
 */
function sendBadRequest(res, message, details = null) {
  const response = { error: message };
  if (details) {
    response.details = details;
  }
  return res.status(400).json(response);
}

/**
 * Send an internal server error response
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 * @param {Object} details - Additional error details (optional)
 * @param {Error} error - Original error object for logging (optional)
 */
function sendInternalServerError(res, message, details = null, error = null) {
  // Log the actual error for debugging in development
  if (error && process.env.NODE_ENV === 'development') {
    console.error('Internal Server Error:', error);
  }
  
  const response = { error: message };
  if (details) {
    response.details = details;
  }
  return res.status(500).json(response);
}

/**
 * Send a not found error response
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 */
function sendNotFound(res, message) {
  return res.status(404).json({ error: message });
}

/**
 * Send a generic error response with appropriate status code
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {Object} details - Additional error details (optional)
 */
function sendError(res, statusCode, message, details = null) {
  const response = { error: message };
  if (details) {
    response.details = details;
  }
  return res.status(statusCode).json(response);
}

module.exports = {
  sendBadRequest,
  sendInternalServerError,
  sendNotFound,
  sendError
};