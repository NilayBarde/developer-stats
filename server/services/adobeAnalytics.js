const axios = require('axios');
const cache = require('../utils/cache');

// Adobe Analytics API credentials (OAuth Server-to-Server)
const ADOBE_CLIENT_ID = process.env.ADOBE_CLIENT_ID;
const ADOBE_CLIENT_SECRET = process.env.ADOBE_CLIENT_SECRET;
const ADOBE_ORG_ID = process.env.ADOBE_ORG_ID;
const ADOBE_REPORT_SUITE_ID = process.env.ADOBE_REPORT_SUITE_ID;

// Cached values
let accessTokenCache = { token: null, expiresAt: null };
let globalCompanyId = null;

/**
 * Get OAuth access token (cached)
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
 * Discover Global Company ID from Adobe API (cached)
 */
async function getGlobalCompanyId() {
  if (globalCompanyId) return globalCompanyId;
  
  const token = await getAccessToken();
  const response = await axios.get('https://analytics.adobe.io/discovery/me', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-api-key': ADOBE_CLIENT_ID
    }
  });
  
  globalCompanyId = response.data?.imsOrgs?.[0]?.companies?.[0]?.globalCompanyId;
  if (!globalCompanyId) throw new Error('Could not discover Global Company ID');
  
  return globalCompanyId;
}

/**
 * Make authenticated request to Adobe Analytics API
 */
async function apiRequest(endpoint, options = {}) {
  const token = await getAccessToken();
  const companyId = await getGlobalCompanyId();
  
  return axios({
    url: `https://analytics.adobe.io/api/${companyId}${endpoint}`,
    method: options.method || 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-api-key': ADOBE_CLIENT_ID,
      'x-gw-ims-org-id': ADOBE_ORG_ID,
      'Content-Type': 'application/json'
    },
    data: options.data,
    timeout: 30000
  }).then(res => res.data);
}

/**
 * Get analytics data for a date range
 */
async function getAnalyticsData(dateRange = null) {
  if (!ADOBE_REPORT_SUITE_ID) {
    throw new Error('ADOBE_REPORT_SUITE_ID is required');
  }

  const cacheKey = `adobe-analytics:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // Default to last 30 days
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const startDate = dateRange?.start 
    ? new Date(dateRange.start).toISOString().split('T')[0] 
    : thirtyDaysAgo.toISOString().split('T')[0];
  const endDate = dateRange?.end 
    ? new Date(dateRange.end).toISOString().split('T')[0] 
    : today.toISOString().split('T')[0];

  const data = await apiRequest('/reports', {
    method: 'POST',
    data: {
      rsid: ADOBE_REPORT_SUITE_ID,
      globalFilters: [{
        type: 'dateRange',
        dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
      }],
      metricContainer: {
        metrics: [
          { id: 'metrics/visitors', columnId: '0' },
          { id: 'metrics/visits', columnId: '1' },
          { id: 'metrics/pageviews', columnId: '2' }
        ]
      },
      dimension: 'variables/daterangeday',
      settings: { countRepeatInstances: true, limit: 1000 }
    }
  });

  const result = { data, dateRange: { start: startDate, end: endDate }, timestamp: new Date().toISOString() };
  cache.set(cacheKey, result, 300);
  return result;
}

/**
 * Get stats summary
 */
async function getStats(dateRange = null) {
  try {
    const analyticsData = await getAnalyticsData(dateRange);
    const totals = analyticsData.data?.summaryData?.totals || [0, 0, 0];
    
    const dailyData = (analyticsData.data?.rows || []).map(row => ({
      date: row.value,
      visitors: row.data?.[0] || 0,
      visits: row.data?.[1] || 0,
      pageViews: row.data?.[2] || 0
    }));
    
    return {
      totalVisitors: totals[0],
      totalVisits: totals[1],
      totalPageViews: totals[2],
      dailyData,
      dateRange: analyticsData.dateRange,
      timestamp: analyticsData.timestamp
    };
  } catch (error) {
    console.error('Adobe Analytics error:', error.message);
    return { error: error.message };
  }
}

/**
 * Test authentication
 */
async function testAuth() {
  try {
    await getAccessToken();
    const companyId = await getGlobalCompanyId();
    return { success: true, globalCompanyId: companyId, reportSuiteId: ADOBE_REPORT_SUITE_ID };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = { getStats, getAnalyticsData, testAuth };
