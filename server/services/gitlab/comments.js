/**
 * GitLab Review Comments
 * 
 * Fetches comment counts using Events API (matches engineering-metrics script).
 * Queries each month separately to avoid GitLab pagination limits.
 */

const cache = require('../../utils/cache');
const { gitlabApi, GITLAB_USERNAME, GITLAB_TOKEN, createRestClient } = require('./api');
const { getProjectNames } = require('./mrs');
const { getCurrentUserId } = require('./events');

const MAX_PAGES_PER_MONTH = 30;
const CACHE_TTL = 300; // 5 minutes

/**
 * Generate month ranges for the date range (YYYY-MM-DD format)
 */
function getMonthRanges(dateRange) {
  const { getDateRange } = require('../../utils/dateHelpers');
  const range = getDateRange(dateRange);
  
  const start = range.start || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const end = range.end || new Date();
  
  const months = [];
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  const endYear = end.getUTCFullYear();
  const endMonth = end.getUTCMonth();
  
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const monthStr = String(month + 1).padStart(2, '0');
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    
    months.push({
      start: `${year}-${monthStr}-01`,
      end: `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`
    });
    
    month++;
    if (month > 11) {
      month = 0;
      year++;
    }
  }
  
  return months;
}

/**
 * Calculate months in date range
 */
function calculateMonthsInRange(dateRange) {
  if (!dateRange) return 1;
  
  const { getDateRange } = require('../../utils/dateHelpers');
  const range = getDateRange(dateRange);
  
  if (range.start === null && range.end === null) return 12;
  
  const start = range.start;
  const end = range.end || new Date();
  
  const monthsDiff = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 
    + (end.getUTCMonth() - start.getUTCMonth()) + 1;
  
  return Math.max(1, monthsDiff);
}

/**
 * Fetch events for a single month
 */
async function fetchMonthEvents(apiClient, userId, month) {
  const events = [];
  let page = 1;
  
  while (page <= MAX_PAGES_PER_MONTH) {
    try {
      const response = await apiClient.get(`/users/${userId}/events`, {
        params: {
          action: 'commented',
          per_page: 100,
          page,
          after: month.start,
          before: month.end
        }
      });
      
      if (!response.data?.length) break;
      events.push(...response.data);
      if (response.data.length < 100) break;
      page++;
    } catch {
      break;
    }
  }
  
  return events;
}

/**
 * Fetch comment stats for a user (matches engineering-metrics script)
 * @param {Object|null} dateRange - Date range to query
 * @param {Object|null} credentials - { username, token, baseURL }
 */
async function getReviewComments(dateRange = null, credentials = null) {
  const username = credentials?.username || GITLAB_USERNAME;
  const token = credentials?.token || GITLAB_TOKEN;
  const baseURL = credentials?.baseURL || process.env.GITLAB_BASE_URL || 'https://gitlab.com';
  
  const emptyResult = { 
    totalComments: 0, mrsReviewed: 0, avgCommentsPerMR: 0, 
    avgReviewsPerMonth: 0, avgCommentsPerMonth: 0, byRepo: [], monthlyComments: {} 
  };
  
  if (!username || !token) return emptyResult;

  const cacheKey = `gitlab-comments:v12:${username}:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  
  const apiClient = credentials ? createRestClient(username, token, baseURL) : gitlabApi;
  
  // Resolve user ID (use directly if numeric)
  let userId = username;
  if (!/^\d+$/.test(username)) {
    userId = await getCurrentUserId(credentials);
    if (!userId) return emptyResult;
  }
  
  // Fetch events for each month
  const monthRanges = getMonthRanges(dateRange);
  const commentsByMonth = new Map();
  const commentsByRepo = new Map();
  const mrsWithComments = new Set();
  let totalComments = 0;
  
  for (const month of monthRanges) {
    const events = await fetchMonthEvents(apiClient, userId, month);
    
    for (const event of events) {
      totalComments++;
      
      // Track MR-specific data
      if (event.target_type === 'MergeRequest' && event.project_id && event.target_iid) {
        const mrKey = `${event.project_id}-${event.target_iid}`;
        mrsWithComments.add(mrKey);
        
        const projectId = String(event.project_id);
        if (!commentsByRepo.has(projectId)) {
          commentsByRepo.set(projectId, { comments: 0, mrsReviewed: new Set() });
        }
        commentsByRepo.get(projectId).comments++;
        commentsByRepo.get(projectId).mrsReviewed.add(mrKey);
      }
      
      // Track monthly totals
      if (event.created_at) {
        const eventMonth = event.created_at.substring(0, 7);
        commentsByMonth.set(eventMonth, (commentsByMonth.get(eventMonth) || 0) + 1);
      }
    }
  }
  
  // Get project names for display
  const projectIds = [...commentsByRepo.keys()];
  const projectNamesMap = await getProjectNames(projectIds, credentials);
  
  const byRepo = Array.from(commentsByRepo.entries())
    .map(([projectId, data]) => ({
      repo: projectNamesMap.get(projectId) || projectId,
      comments: data.comments,
      mrsReviewed: data.mrsReviewed.size
    }))
    .sort((a, b) => b.comments - a.comments);

  const totalMonths = calculateMonthsInRange(dateRange);
  const mrsReviewedCount = mrsWithComments.size;

  const result = {
    totalComments,
    mrsReviewed: mrsReviewedCount,
    avgCommentsPerMR: mrsReviewedCount > 0 ? Math.round((totalComments / mrsReviewedCount) * 10) / 10 : 0,
    avgReviewsPerMonth: Math.round((mrsReviewedCount / totalMonths) * 10) / 10,
    avgCommentsPerMonth: Math.round((totalComments / totalMonths) * 10) / 10,
    byRepo,
    monthlyComments: Object.fromEntries(commentsByMonth)
  };

  cache.set(cacheKey, result, CACHE_TTL);
  return result;
}

module.exports = {
  getReviewComments
};
