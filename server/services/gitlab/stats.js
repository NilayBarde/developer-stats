/**
 * GitLab Stats
 * 
 * Handles stats calculation using Events API and MR data.
 */

const cache = require('../../utils/cache');
const { calculatePRStats } = require('../../utils/statsHelpers');
const { GITLAB_USERNAME, GITLAB_TOKEN } = require('./api');
const { getActionStats } = require('./events');
const { getAllMergeRequests } = require('./mrs');

/**
 * Get GitLab stats using Events API to match engineering-metrics format
 * Primary metrics: commented, created, merged, approved
 * Also includes MR details for monthly breakdown and dashboard compatibility
 * @param {Object|null} dateRange - Optional date range
 * @param {Object|null} credentials - Optional credentials { username, token, baseURL }
 */
async function getStats(dateRange = null, credentials = null) {
  const username = credentials?.username || GITLAB_USERNAME;
  const token = credentials?.token || GITLAB_TOKEN;
  
  if (!username || !token) {
    throw new Error('GitLab credentials not configured');
  }

  const cacheKey = `gitlab-stats:v5:${username}:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Fetch both Events API (for engineering-metrics alignment) AND MR details (for monthly breakdown)
  const [actionStats, mrs] = await Promise.all([
    getActionStats(dateRange, credentials),
    getAllMergeRequests(credentials, dateRange)
  ]);

  // Calculate MR stats for monthly data and dashboard compatibility
  const mrStats = calculatePRStats(mrs, [], dateRange, {
    mergedField: 'merged_at',
    getState: (mr) => mr.state,
    isMerged: (mr) => mr.state === 'merged',
    isOpen: (mr) => mr.state === 'opened',
    isClosed: (mr) => mr.state === 'closed',
    groupByKey: (mr) => mr._projectPath || 'unknown'
  });

  const result = {
    source: 'gitlab',
    username: username,
    // Primary metrics matching engineering-metrics format
    commented: actionStats.commented,
    created: actionStats.created,
    merged: actionStats.merged,
    approved: actionStats.approved,
    // Legacy/dashboard fields for backwards compatibility
    total: mrStats.total,
    avgMRsPerMonth: mrStats.avgMRsPerMonth,
    monthlyMRs: mrStats.monthlyMRs,
    monthlyMerged: mrStats.monthlyMerged,
    reposAuthored: mrStats.reposAuthored,
    repoBreakdown: mrStats.repoBreakdown,
    byProject: mrStats.grouped,
    mrs: mrStats.items
  };
  
  cache.set(cacheKey, result, 300);
  return result;
}

module.exports = {
  getStats
};

