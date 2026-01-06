/**
 * GitLab Events API
 * 
 * Handles fetching events by action type using Events API.
 */

const cache = require('../../utils/cache');
const { gitlabApi } = require('./api');

/**
 * Get current user ID from GitLab (needed for Events API)
 */
async function getCurrentUserId() {
  const cacheKey = 'gitlab-user-id';
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const response = await gitlabApi.get('/user');
    const userId = response.data.id;
    cache.set(cacheKey, userId, 3600); // Cache for 1 hour
    return userId;
  } catch (error) {
    console.error('Failed to get GitLab user ID:', error.message);
    return null;
  }
}

/**
 * Fetch events by action type using Events API (matches engineering-metrics)
 * Actions: commented, created, merged, approved
 */
async function getEventsByAction(action, dateRange = null) {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const events = [];
  let page = 1;
  const maxPages = 10; // Limit pagination

  // Build date params
  const params = { action, per_page: 100 };
  if (dateRange?.start) params.after = dateRange.start;
  if (dateRange?.end) params.before = dateRange.end;

  while (page <= maxPages) {
    try {
      const response = await gitlabApi.get(`/users/${userId}/events`, {
        params: { ...params, page }
      });

      // Stop only when we get an empty page (GitLab may return < 100 but still have more pages)
      if (response.data.length === 0) break;
      events.push(...response.data);
      page++;
    } catch (error) {
      console.error(`  Events API error for action ${action}:`, error.message);
      break;
    }
  }

  return events;
}

/**
 * Get action stats using Events API (matches engineering-metrics format)
 * Returns: { commented, created, merged, approved }
 */
async function getActionStats(dateRange = null) {
  const cacheKey = `gitlab-actions:v1:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ GitLab action stats served from cache');
    return cached;
  }

  console.log('🔷 Fetching GitLab action stats via Events API...');
  const startTime = Date.now();

  // Fetch all actions in parallel
  const [commentedEvents, createdEvents, mergedEvents, approvedEvents] = await Promise.all([
    getEventsByAction('commented', dateRange),
    getEventsByAction('created', dateRange),
    getEventsByAction('merged', dateRange),
    getEventsByAction('approved', dateRange)
  ]);

  const result = {
    commented: commentedEvents.length,
    created: createdEvents.length,
    merged: mergedEvents.length,
    approved: approvedEvents.length
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
