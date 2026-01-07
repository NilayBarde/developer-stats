/**
 * GitLab Events API
 * 
 * Handles fetching events by action type using Events API.
 */

const cache = require('../../utils/cache');
const { gitlabApi, createRestClient } = require('./api');
const { getAllMergeRequests } = require('./mrs');
const { handleApiError } = require('../../utils/apiHelpers');

/**
 * Get current user ID from GitLab (needed for Events API)
 * @param {Object|null} credentials - Optional credentials { username, token, baseURL }
 */
async function getCurrentUserId(credentials = null) {
  const username = credentials?.username || require('./api').GITLAB_USERNAME;
  const cacheKey = `gitlab-user-id:${username}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const customClient = credentials ? createRestClient(username, credentials.token, credentials.baseURL) : gitlabApi;
  
  try {
    const response = await customClient.get('/user');
    const userId = response.data.id;
    cache.set(cacheKey, userId, 3600); // Cache for 1 hour
    return userId;
  } catch (error) {
    handleApiError(error, 'GitLab', { logError: false, throwError: false });
    return null;
  }
}

/**
 * Fetch events by action type using Events API (matches engineering-metrics)
 * Actions: commented, created, merged, approved
 * @param {string} action - Action type
 * @param {Object|null} dateRange - Optional date range
 * @param {Object|null} credentials - Optional credentials { username, token, baseURL }
 */
async function getEventsByAction(action, dateRange = null, credentials = null) {
  const userId = await getCurrentUserId(credentials);
  if (!userId) return [];

  const customClient = credentials ? createRestClient(credentials.username, credentials.token, credentials.baseURL) : gitlabApi;
  
  const events = [];
  let page = 1;
  const maxPages = 10; // Limit pagination

  // Build date params
  const params = { action, per_page: 100 };
  if (dateRange?.start) params.after = dateRange.start;
  if (dateRange?.end) params.before = dateRange.end;

  while (page <= maxPages) {
    try {
      const response = await customClient.get(`/users/${userId}/events`, {
        params: { ...params, page }
      });

      // Stop only when we get an empty page (GitLab may return < 100 but still have more pages)
      if (response.data.length === 0) break;
      events.push(...response.data);
      page++;
    } catch (error) {
      handleApiError(error, 'GitLab', { logError: false }); // Don't log, just break
      break;
    }
  }

  return events;
}

/**
 * Get action stats using MRs data (Events API only works for authenticated user)
 * Returns: { commented, created, merged, approved }
 * @param {Object|null} dateRange - Optional date range
 * @param {Object|null} credentials - Optional credentials { username, token, baseURL }
 */
async function getActionStats(dateRange = null, credentials = null) {
  const username = credentials?.username || require('./api').GITLAB_USERNAME;
  const token = credentials?.token || require('./api').GITLAB_TOKEN;
  const baseURL = credentials?.baseURL || require('./api').GITLAB_BASE_URL || 'https://gitlab.com';
  
  const cacheKey = `gitlab-actions:v2:${username}:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ GitLab action stats served from cache');
    return cached;
  }

  console.log(`🔷 Fetching GitLab action stats for ${username}...`);
  const startTime = Date.now();

  // Get MRs to calculate stats from (with date range filtering at API level)
  const mrs = await getAllMergeRequests(credentials, dateRange);
  
  // MRs are already filtered by date range at API level, but we keep this for safety
  let filteredMRs = mrs;
  if (dateRange?.start || dateRange?.end) {
    filteredMRs = mrs.filter(mr => {
      const createdDate = mr.created_at ? new Date(mr.created_at) : null;
      if (!createdDate) return false;
      if (dateRange.start && createdDate < new Date(dateRange.start)) return false;
      if (dateRange.end && createdDate > new Date(dateRange.end)) return false;
      return true;
    });
  }

  // Calculate stats from MRs
  const created = filteredMRs.length;
  const merged = filteredMRs.filter(mr => mr.state === 'merged' && mr.merged_at).length;
  
  // For commented and approved, we can't easily get this for other users without their token
  // Events API only works for the authenticated user
  // We'll set these to 0 for now, or try to get them via REST API if possible
  const customRestClient = createRestClient(username, token, baseURL);
  let commented = 0;
  let approved = 0;
  
  // Try to get commented/approved stats via REST API search
  try {
    // Search for MRs where user is a reviewer (commented/approved)
    let reviewerPage = 1;
    const reviewedMRs = new Set();
    const isNumericId = /^\d+$/.test(username);
    
    while (reviewerPage <= 10) {
      const reviewerParams = {
        state: 'all',
        scope: 'all',
        per_page: 100,
        page: reviewerPage
      };
      
      // Use reviewer_id for numeric IDs, reviewer_username for usernames
      if (isNumericId) {
        reviewerParams.reviewer_id = username;
      } else {
        reviewerParams.reviewer_username = username;
      }
      
      const response = await customRestClient.get('/merge_requests', {
        params: reviewerParams
      }).catch(() => ({ data: [] }));
      
      if (response.data.length === 0) break;
      response.data.forEach(mr => reviewedMRs.add(`${mr.project_id}-${mr.iid}`));
      if (response.data.length < 100) break;
      reviewerPage++;
    }
    
    // Approximate: if user reviewed MRs, they likely commented/approved
    // This is an approximation since we can't easily distinguish without detailed API calls
    commented = reviewedMRs.size;
    approved = reviewedMRs.size; // Approximate - GitLab doesn't easily distinguish approve vs comment
  } catch (error) {
    console.warn(`  Could not fetch review stats for ${username}:`, error.message);
  }

  const result = {
    commented: commented,
    created: created,
    merged: merged,
    approved: approved
  };

  cache.set(cacheKey, result, 300);
  console.log(`  ✓ Actions: commented=${result.commented}, created=${result.created}, merged=${result.merged}, approved=${result.approved} (${Date.now() - startTime}ms)`);

  return result;
}

module.exports = {
  getCurrentUserId,
  getEventsByAction,
  getActionStats
};
