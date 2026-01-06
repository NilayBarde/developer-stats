/**
 * Adobe Analytics API Client - Core API functionality and authentication
 * Handles all direct communication with the Adobe Analytics REST API
 */

const axios = require('axios');

// Adobe Analytics API credentials (OAuth Server-to-Server)
const ADOBE_CLIENT_ID = process.env.ADOBE_CLIENT_ID;
const ADOBE_CLIENT_SECRET = process.env.ADOBE_CLIENT_SECRET;
const ADOBE_ORG_ID = process.env.ADOBE_ORG_ID;
const ADOBE_REPORT_SUITE_ID = process.env.ADOBE_REPORT_SUITE_ID;

// Cached values
let accessTokenCache = { token: null, expiresAt: null };
let globalCompanyId = null;

// All Bet Clicks segment ID (DraftKings + ESPN Bet)
const ALL_BET_CLICKS_SEGMENT_ID = 's300003201_694c7a0c873e3d78f596f84f';

/**
 * Get OAuth access token (cached)
 * @returns {Promise<string>} Access token
 */
async function getAccessToken() {
  if (accessTokenCache.token && Date.now() < accessTokenCache.expiresAt) {
    return accessTokenCache.token;
  }

  if (!ADOBE_CLIENT_ID || !ADOBE_CLIENT_SECRET || !ADOBE_ORG_ID) {
    throw new Error('Adobe Analytics credentials not configured');
  }

  const tokenData = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: ADOBE_CLIENT_ID,
    client_secret: ADOBE_CLIENT_SECRET,
    scope: 'openid,AdobeID,additional_info.projectedProductContext'
  });

  const response = await axios.post(
    'https://ims-na1.adobelogin.com/ims/token/v3',
    tokenData.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  accessTokenCache.token = response.data.access_token;
  accessTokenCache.expiresAt = Date.now() + ((response.data.expires_in - 3600) * 1000);
  
  return accessTokenCache.token;
}

/**
 * Retry a request with exponential backoff for 429 rate limit errors
 * Adobe limit: 12 requests per 6 seconds (2/sec)
 * @param {Function} requestFn - Function that returns a promise
 * @param {number} maxRetries - Max retry attempts
 * @returns {Promise<any>} Result from requestFn
 */
async function retryWithBackoff(requestFn, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await requestFn();
    } catch (error) {
      lastError = error;
      if (error.response?.status === 429) {
        const retryAfter = parseInt(error.response.headers?.['retry-after'] || '2', 10);
        const waitTime = Math.max(retryAfter * 1000, (attempt + 1) * 2000);
        console.log(`  ⏳ Rate limited (429). Waiting ${waitTime/1000}s before retry ${attempt + 1}/${maxRetries}...`);
        await new Promise(r => setTimeout(r, waitTime));
      } else {
        throw error;
      }
    }
  }
  throw lastError;
}

/**
 * Discover Global Company ID from Adobe API (cached)
 * @returns {Promise<string>} Global company ID
 */
async function getGlobalCompanyId() {
  if (globalCompanyId) return globalCompanyId;
  
  const token = await getAccessToken();
  const response = await retryWithBackoff(() => 
    axios.get('https://analytics.adobe.io/discovery/me', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'x-api-key': ADOBE_CLIENT_ID
      }
    })
  );
  
  globalCompanyId = response.data?.imsOrgs?.[0]?.companies?.[0]?.globalCompanyId;
  if (!globalCompanyId) throw new Error('Could not discover Global Company ID');
  
  return globalCompanyId;
}

/**
 * Make authenticated request to Adobe Analytics API
 * @param {string} endpoint - API endpoint path
 * @param {Object} options - Request options (method, data, timeout)
 * @returns {Promise<any>} API response data
 */
async function apiRequest(endpoint, options = {}) {
  const token = await getAccessToken();
  const companyId = await getGlobalCompanyId();
  const timeout = options.timeout || 30000;
  
  return retryWithBackoff(() => 
    axios({
      url: `https://analytics.adobe.io/api/${companyId}${endpoint}`,
      method: options.method || 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'x-api-key': ADOBE_CLIENT_ID,
        'x-gw-ims-org-id': ADOBE_ORG_ID,
        'Content-Type': 'application/json'
      },
      data: options.data,
      timeout
    }).then(res => res.data)
  );
}

/**
 * Test Adobe Analytics authentication
 * @returns {Promise<Object>} Auth status
 */
async function testAuth() {
  try {
    const token = await getAccessToken();
    const companyId = await getGlobalCompanyId();
    
    return {
      status: 'success',
      message: 'Adobe Analytics authentication successful',
      globalCompanyId: companyId,
      reportSuiteId: ADOBE_REPORT_SUITE_ID
    };
  } catch (error) {
    return {
      status: 'error',
      message: error.message,
      error: error.toString()
    };
  }
}

/**
 * List all available report suites
 * @returns {Promise<Array>} Report suites
 */
async function listReportSuites() {
  const data = await apiRequest('/collections/suites?limit=50');
  return data.content || [];
}

/**
 * Check if Adobe Analytics is configured
 * @returns {boolean}
 */
function isConfigured() {
  return !!(ADOBE_CLIENT_ID && ADOBE_CLIENT_SECRET && ADOBE_ORG_ID && ADOBE_REPORT_SUITE_ID);
}

module.exports = {
  getAccessToken,
  retryWithBackoff,
  getGlobalCompanyId,
  apiRequest,
  testAuth,
  listReportSuites,
  isConfigured,
  // Constants
  ADOBE_CLIENT_ID,
  ADOBE_CLIENT_SECRET,
  ADOBE_ORG_ID,
  ADOBE_REPORT_SUITE_ID,
  ALL_BET_CLICKS_SEGMENT_ID
};
