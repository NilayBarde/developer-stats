/**
 * GitHub Review Comments
 * 
 * Handles fetching review comments made by user on others' PRs.
 * Uses contributionsCollection GraphQL API (like engineering-metrics).
 */

const cache = require('../../utils/cache');
const { graphqlQuery, PR_REVIEWS_QUERY, GITHUB_USERNAME, GITHUB_TOKEN, createGraphQLClient } = require('./api');

/**
 * Fetch all PR review contributions with pagination to get unique PRs
 */
async function fetchAllPRReviews(username, from, to, customClient) {
  const uniquePRs = new Set();
  const prsByRepo = new Map();
  let cursor = null;
  let hasNextPage = true;
  
  while (hasNextPage) {
    try {
      const data = await graphqlQuery(PR_REVIEWS_QUERY, { 
        login: username, 
        from: from.toISOString(),
        to: to.toISOString(),
        cursor
      }, customClient);
      
      const contributions = data.user?.contributionsCollection?.pullRequestReviewContributions;
      if (!contributions?.nodes) break;
      
      for (const node of contributions.nodes) {
        const pr = node.pullRequest;
        if (pr?.id) {
          uniquePRs.add(pr.id);
          
          const repoName = pr.repository?.nameWithOwner;
          if (repoName) {
            if (!prsByRepo.has(repoName)) {
              prsByRepo.set(repoName, new Set());
            }
            prsByRepo.get(repoName).add(pr.id);
          }
        }
      }
      
      hasNextPage = contributions.pageInfo?.hasNextPage || false;
      cursor = contributions.pageInfo?.endCursor;
    } catch (error) {
      console.warn('⚠️ Error fetching PR reviews:', error.message);
      break;
    }
  }
  
  return { uniquePRs, prsByRepo };
}

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
 * Uses contributionsCollection GraphQL API (like engineering-metrics)
 * @param {Object|null} dateRange - Optional date range
 * @param {Object|null} credentials - Optional credentials { username, token, baseURL }
 */
async function getReviewComments(dateRange = null, credentials = null) {
  const username = credentials?.username || GITHUB_USERNAME;
  const token = credentials?.token || GITHUB_TOKEN;
  const baseURL = credentials?.baseURL || process.env.GITHUB_BASE_URL || 'https://github.com';
  
  if (!username || !token) {
    return { totalComments: 0, prsReviewed: 0, avgCommentsPerPR: 0, avgReviewsPerMonth: 0, avgCommentsPerMonth: 0, byRepo: [], monthlyComments: {} };
  }

  // Include username in cache key to avoid cache collisions
  const cacheKey = `github-comments:v6:${username}:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const to = dateRange?.end ? new Date(dateRange.end) : new Date();
  const from = dateRange?.start ? new Date(dateRange.start) : new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);

  try {
    const customClient = credentials ? createGraphQLClient(username, token, baseURL) : null;
    
    // Fetch unique PRs reviewed by paginating through all PR review contributions
    const { uniquePRs, prsByRepo } = await fetchAllPRReviews(username, from, to, customClient);
    const prsReviewed = uniquePRs.size;
    
    // Build breakdown by repository with unique PR counts
    const byRepo = Array.from(prsByRepo.entries())
      .map(([repo, prIds]) => ({
        repo,
        prsReviewed: prIds.size,
        comments: 0 // contributionsCollection doesn't provide comment counts
      }))
      .sort((a, b) => b.prsReviewed - a.prsReviewed);

    // Estimate comments: contributionsCollection doesn't provide exact comment counts
    // Use a reasonable default average (2 comments per PR review is typical)
    // This matches engineering-metrics approach
    const DEFAULT_AVG_COMMENTS_PER_PR = 2.0;
    const avgCommentsPerPR = DEFAULT_AVG_COMMENTS_PER_PR;
    const totalComments = Math.round(prsReviewed * avgCommentsPerPR);

    // Update byRepo with estimated comments
    const byRepoWithComments = byRepo.map(r => ({
      ...r,
      comments: Math.round(r.prsReviewed * avgCommentsPerPR)
    }));

    // Calculate monthly breakdown
    // Since contributionsCollection doesn't provide monthly breakdown,
    // we'll distribute evenly across the date range
    const totalMonthsInRange = calculateMonthsInRange(dateRange);
    const avgReviewsPerMonth = totalMonthsInRange > 0 
      ? Math.round((prsReviewed / totalMonthsInRange) * 10) / 10 
      : 0;
    const avgCommentsPerMonth = totalMonthsInRange > 0
      ? Math.round((totalComments / totalMonthsInRange) * 10) / 10
      : 0;

    // Generate monthly breakdown (distribute evenly across months)
    const monthlyComments = {};
    if (totalMonthsInRange > 0 && prsReviewed > 0) {
      const reviewsPerMonth = Math.floor(prsReviewed / totalMonthsInRange);
      const remainder = prsReviewed % totalMonthsInRange;
      
      let currentDate = new Date(from);
      for (let i = 0; i < totalMonthsInRange; i++) {
        const monthKey = currentDate.toISOString().substring(0, 7);
        const reviewsThisMonth = reviewsPerMonth + (i < remainder ? 1 : 0);
        monthlyComments[monthKey] = Math.round(reviewsThisMonth * avgCommentsPerPR);
        
        // Move to next month
        currentDate.setMonth(currentDate.getMonth() + 1);
      }
    }

    const result = {
      totalComments,
      prsReviewed,
      avgCommentsPerPR,
      avgReviewsPerMonth,
      avgCommentsPerMonth,
      byRepo: byRepoWithComments,
      monthlyComments
    };

    cache.set(cacheKey, result, 300);
    
    return result;
  } catch (error) {
    console.warn('⚠️ contributionsCollection not available for review comments:', error.message);
    return { totalComments: 0, prsReviewed: 0, avgCommentsPerPR: 0, avgReviewsPerMonth: 0, avgCommentsPerMonth: 0, byRepo: [], monthlyComments: {} };
  }
}

module.exports = {
  getReviewComments
};

