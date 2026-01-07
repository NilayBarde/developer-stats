/**
 * GitHub Review Comments
 * 
 * Handles fetching review comments made by user on others' PRs.
 */

const cache = require('../../utils/cache');
const { githubApi, GITHUB_USERNAME, GITHUB_TOKEN, createRestClient } = require('./api');
const { handleApiError } = require('../../utils/apiHelpers');

/**
 * Calculate total months in date range
 */
function calculateMonthsInRange(dateRange) {
  if (!dateRange) return 1;
  
  const { getDateRange } = require('../../utils/dateHelpers');
  const range = getDateRange(dateRange);
  
  if (range.start === null && range.end === null) {
    return 12; // Default to 12 months for "all time"
  }
  
  const start = range.start;
  const end = range.end || new Date();
  
  const startYear = start.getUTCFullYear();
  const startMonth = start.getUTCMonth();
  const endYear = end.getUTCFullYear();
  const endMonth = end.getUTCMonth();
  
  // Calculate difference in months
  const monthsDiff = (endYear - startYear) * 12 + (endMonth - startMonth) + 1; // +1 to include both start and end months
  
  return Math.max(1, monthsDiff);
}

/**
 * Fetch review comments made by user on others' PRs
 * Uses GitHub Search API to find PRs where user commented
 * @param {Object|null} dateRange - Optional date range
 * @param {Object|null} credentials - Optional credentials { username, token, baseURL }
 */
async function getReviewComments(dateRange = null, credentials = null) {
  const username = credentials?.username || GITHUB_USERNAME;
  const token = credentials?.token || GITHUB_TOKEN;
  const baseURL = credentials?.baseURL || process.env.GITHUB_BASE_URL || 'https://github.com';
  
  if (!username || !token) {
    return { totalComments: 0, prsReviewed: 0, avgCommentsPerPR: 0, avgReviewsPerMonth: 0, byRepo: [], monthlyComments: {} };
  }

  // Include username in cache key to avoid cache collisions
  const cacheKey = `github-comments:v4:${username}:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`✓ GitHub comments served from cache for ${username}`);
    return cached;
  }

  console.log(`📦 Fetching GitHub review comments for ${username}...`);
  
  // Use custom API client if credentials provided, otherwise use default
  const apiClient = credentials ? createRestClient(username, token, baseURL) : githubApi;
  
  // Build search query
  let query = `commenter:${username} type:pr -author:${username}`;
  if (dateRange?.start) query += ` created:>=${dateRange.start}`;
  if (dateRange?.end) query += ` created:<=${dateRange.end}`;

  const reviewedPRs = [];
  let page = 1;

  while (page <= 10) {
    try {
      const response = await apiClient.get('/search/issues', {
        params: { q: query, per_page: 100, page, sort: 'updated', order: 'desc' }
      });

      if (response.data.items.length === 0) break;
      reviewedPRs.push(...response.data.items);
      
      if (response.data.items.length < 100 || reviewedPRs.length >= response.data.total_count) break;
      page++;
    } catch (error) {
      handleApiError(error, 'GitHub', { logError: false }); // Don't log, just break
      break;
    }
  }

  console.log(`  Found ${reviewedPRs.length} PRs where user commented`);

  // Group by repo and month
  const commentsByRepo = new Map();
  const commentsByMonth = new Map();
  
  for (const pr of reviewedPRs) {
    const repo = pr.repository_url?.match(/repos\/(.+)$/)?.[1] || 'unknown';
    const month = pr.created_at?.substring(0, 7) || 'unknown';
    
    if (!commentsByRepo.has(repo)) {
      commentsByRepo.set(repo, { repo, prsReviewed: 0 });
    }
    commentsByRepo.get(repo).prsReviewed++;
    
    if (!commentsByMonth.has(month)) {
      commentsByMonth.set(month, 0);
    }
    commentsByMonth.set(month, commentsByMonth.get(month) + 1);
  }

  // Sample PRs to estimate average comments
  const sampleSize = Math.min(30, reviewedPRs.length);
  let sampleComments = 0;
  
  if (sampleSize > 0) {
    console.log(`  → Sampling ${sampleSize} PRs for comment counts...`);
    
    const samplePRs = reviewedPRs.slice(0, sampleSize);
    const results = await Promise.all(samplePRs.map(async (pr) => {
      try {
        const repo = pr.repository_url?.match(/repos\/(.+)$/)?.[1];
        if (!repo) return 1;

        const [reviewRes, issueRes] = await Promise.all([
          apiClient.get(`/repos/${repo}/pulls/${pr.number}/comments`, { params: { per_page: 100 } }).catch(() => ({ data: [] })),
          apiClient.get(`/repos/${repo}/issues/${pr.number}/comments`, { params: { per_page: 100 } }).catch(() => ({ data: [] }))
        ]);

        const reviewComments = (reviewRes.data || []).filter(c => c.user?.login === username).length;
        const issueComments = (issueRes.data || []).filter(c => c.user?.login === username).length;
        return reviewComments + issueComments;
      } catch {
        return 1;
      }
    }));
    
    sampleComments = results.reduce((sum, count) => sum + count, 0);
  }

  const avgCommentsPerPR = sampleSize > 0 ? Math.round((sampleComments / sampleSize) * 10) / 10 : 1;
  const prsReviewed = reviewedPRs.length;
  const totalComments = Math.round(prsReviewed * avgCommentsPerPR);

  const byRepo = Array.from(commentsByRepo.values()).map(r => ({
    ...r,
    comments: Math.round(r.prsReviewed * avgCommentsPerPR)
  })).sort((a, b) => b.comments - a.comments);

  const totalMonthsInRange = calculateMonthsInRange(dateRange);
  
  const result = {
    totalComments,
    prsReviewed,
    avgCommentsPerPR,
    avgReviewsPerMonth: Math.round((prsReviewed / totalMonthsInRange) * 10) / 10, // PRs reviewed per month
    avgCommentsPerMonth: Math.round((totalComments / totalMonthsInRange) * 10) / 10, // Comments per month
    byRepo,
    monthlyComments: Object.fromEntries(
      Array.from(commentsByMonth.entries()).map(([month, prs]) => [month, Math.round(prs * avgCommentsPerPR)])
    )
  };

  cache.set(cacheKey, result, 300);
  console.log(`  ✓ ${prsReviewed} PRs reviewed, ~${totalComments} comments`);
  
  return result;
}

module.exports = {
  getReviewComments
};

