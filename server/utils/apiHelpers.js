/**
 * API Helper Functions
 * Standardized utilities for API error handling and client creation
 * Inspired by MCP server patterns for consistency
 */

const axios = require('axios');

/**
 * Handle API errors consistently across all services
 * @param {Error} error - The error object from axios/fetch
 * @param {string} serviceName - Name of the service (e.g., 'Jira', 'GitLab', 'GitHub')
 * @param {Object} options - Optional configuration
 * @param {boolean} options.logError - Whether to log the error (default: true)
 * @param {boolean} options.throwError - Whether to throw the error (default: true)
 * @throws {Error} Always throws an error with a user-friendly message
 */
function handleApiError(error, serviceName, options = {}) {
  const { logError = true, throwError = true } = options;

  if (error.response) {
    const status = error.response.status;
    const statusText = error.response.statusText || '';
    const errorData = error.response.data;
    const message = errorData?.message || errorData?.error || error.message;

    let errorMessage;

    if (status === 401) {
      errorMessage = `${serviceName} authentication failed. Check credentials.`;
    } else if (status === 403) {
      errorMessage = `${serviceName} permission denied. Check API token permissions.`;
    } else if (status === 429) {
      errorMessage = `${serviceName} rate limit exceeded. Please retry later.`;
    } else if (status >= 500) {
      errorMessage = `${serviceName} server error (${status}). Please try again later.`;
    } else {
      errorMessage = `${serviceName} API error (${status}${statusText ? ` ${statusText}` : ''}): ${message}`;
    }

    if (logError) {
      console.error(`❌ ${errorMessage}`);
    }

    if (throwError) {
      const apiError = new Error(errorMessage);
      apiError.status = status;
      apiError.originalError = error;
      throw apiError;
    }

    return { status, message: errorMessage };
  }

  // Network errors or other non-HTTP errors
  const errorMessage = `${serviceName} request failed: ${error.message}`;
  
  if (logError) {
    console.error(`❌ ${errorMessage}`);
  }

  if (throwError) {
    throw new Error(errorMessage);
  }

  return { status: null, message: errorMessage };
}

/**
 * Create a standardized axios client with common configuration
 * @param {Object} config - Client configuration
 * @param {string} config.baseURL - Base URL for the API
 * @param {string} config.token - Authentication token
 * @param {Object} config.headers - Additional headers (default: {})
 * @param {number} config.timeout - Request timeout in ms (default: 30000)
 * @param {string} config.authType - Auth type: 'Bearer' or 'Token' (default: 'Bearer')
 * @param {string} config.authHeader - Custom auth header name (default: 'Authorization')
 * @returns {Object} Configured axios instance
 */
function createApiClient(config) {
  const {
    baseURL,
    token,
    headers = {},
    timeout = 30000,
    authType = 'Bearer',
    authHeader = 'Authorization'
  } = config;

  if (!baseURL || !token) {
    throw new Error('baseURL and token are required for API client');
  }

  const authValue = authType === 'Bearer' 
    ? `Bearer ${token}`
    : authType === 'Token'
    ? token
    : `${authType} ${token}`;

  const normalizedBaseURL = baseURL.replace(/\/$/, ''); // Remove trailing slash

  return axios.create({
    baseURL: normalizedBaseURL,
    headers: {
      [authHeader]: authValue,
      'Content-Type': 'application/json',
      ...headers
    },
    timeout
  });
}

module.exports = {
  handleApiError,
  createApiClient
};
