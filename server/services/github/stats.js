/**
 * GitHub Stats
 * 
 * Handles stats calculation using contributionsCollection and PR data.
 */

const cache = require('../../utils/cache');
const { calculatePRStats } = require('../../utils/statsHelpers');
const { graphqlQuery, CONTRIBUTIONS_QUERY, GITHUB_USERNAME, GITHUB_TOKEN, createGraphQLClient, createRestClient, githubApi } = require('./api');
const { getAllPRs } = require('./prs');
const { handleApiError } = require('../../utils/apiHelpers');

/**
 * Fetch reviews via REST API (more reliable than contributionsCollection for GitHub Enterprise)
 */
async function getReviewsViaREST(username, startDate, endDate, baseURL, restClient) {
  try {
    // Search for PRs reviewed by user (not authored by them)
    const searchQuery = `reviewed-by:${username} type:pr -author:${username} updated:>=${startDate} updated:<=${endDate}`;
    
    const reviewedPRs = [];
    let page = 1;
    
    while (page <= 10) {
      try {
        const response = await restClient.get('/search/issues', {
          params: { 
            q: searchQuery, 
            per_page: 100, 
            page, 
            sort: 'updated', 
            order: 'desc' 
          }
        });
        
        if (!response.data.items || response.data.items.length === 0) break;
        reviewedPRs.push(...response.data.items);
        
        if (response.data.items.length < 100 || reviewedPRs.length >= response.data.total_count) break;
        page++;
      } catch (error) {
        handleApiError(error, 'GitHub', { logError: false }); // Don't log, just break
        break;
      }
    }
    
    // Group by repository
    const reviewsByRepo = new Map();
    reviewedPRs.forEach(pr => {
      const repo = pr.repository_url?.match(/repos\/(.+)$/)?.[1];
      if (repo) {
        if (!reviewsByRepo.has(repo)) {
          reviewsByRepo.set(repo, 0);
        }
        reviewsByRepo.set(repo, reviewsByRepo.get(repo) + 1);
      }
    });
    
    return {
      totalReviews: reviewedPRs.length,
      reviewsByRepo: Array.from(reviewsByRepo.entries()).map(([repo, count]) => ({
        repo,
        count
      }))
    };
  } catch (error) {
    console.error(`  REST API reviews fetch failed:`, error.message);
    return null;
  }
}

/**
 * Get contribution stats via GraphQL contributionsCollection (for PRs created, commits, issues)
 * Uses REST API for reviews (more reliable for GitHub Enterprise)
 */
async function getContributionStats(dateRange = null, credentials = null) {
  const username = credentials?.username || GITHUB_USERNAME;
  const token = credentials?.token || GITHUB_TOKEN;
  const baseURL = credentials?.baseURL || process.env.GITHUB_BASE_URL || 'https://github.com';
  
  const cacheKey = `github-contributions:v2:${username}:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const to = dateRange?.end ? new Date(dateRange.end) : new Date();
  const from = dateRange?.start ? new Date(dateRange.start) : new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);

  const startDateStr = from.toISOString().split('T')[0];
  const endDateStr = to.toISOString().split('T')[0];

  try {
    // Fetch PRs created, commits, issues from contributionsCollection (works reliably)
    const customClient = credentials ? createGraphQLClient(username, token, baseURL) : null;
    const data = await graphqlQuery(CONTRIBUTIONS_QUERY, { 
      login: username, 
      from: from.toISOString(),
      to: to.toISOString()
    }, customClient);
    
    const c = data.user?.contributionsCollection;
    if (!c) {
      return null;
    }

    // Fetch reviews via REST API (more reliable for GitHub Enterprise)
    const restClient = credentials ? createRestClient(username, token, baseURL) : githubApi;
    const restReviews = await getReviewsViaREST(username, startDateStr, endDateStr, baseURL, restClient);

    const result = {
      totalPRs: c.totalPullRequestContributions,
      totalPRReviews: restReviews?.totalReviews ?? c.totalPullRequestReviewContributions ?? 0,
      totalCommits: c.totalCommitContributions,
      totalIssues: c.totalIssueContributions,
      prsByRepo: c.pullRequestContributionsByRepository?.map(r => ({
        repo: r.repository.nameWithOwner,
        count: r.contributions.totalCount
      })) || [],
      reviewsByRepo: restReviews?.reviewsByRepo ?? c.pullRequestReviewContributionsByRepository?.map(r => ({
        repo: r.repository.nameWithOwner,
        count: r.contributions.totalCount
      })) ?? []
    };

    cache.set(cacheKey, result, 300);
    return result;
  } catch (error) {
    console.warn('⚠️ contributionsCollection not available:', error.message);
    return null;
  }
}

/**
 * Get GitHub stats using contributionsCollection to match engineering-metrics format
 * Primary metrics: PRs Created (totalPullRequestContributions), PR Reviews (totalPullRequestReviewContributions)
 * Also includes PR details for monthly breakdown and dashboard compatibility
 * @param {Object|null} dateRange - Optional date range
 * @param {Object|null} credentials - Optional credentials { username, token, baseURL }
 */
async function getStats(dateRange = null, credentials = null) {
  const username = credentials?.username || GITHUB_USERNAME;
  const token = credentials?.token || GITHUB_TOKEN;
  
  if (!username || !token) {
    throw new Error('GitHub credentials not configured');
  }

  const cacheKey = `github-stats:v6:${username}:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Fetch both contributionsCollection (for engineering-metrics alignment) AND PR details (for monthly breakdown)
  const [contributions, prs] = await Promise.all([
    getContributionStats(dateRange, credentials),
    getAllPRs(credentials)
  ]);
  
  if (!contributions) {
    throw new Error('Failed to fetch GitHub contributions');
  }

  // Calculate PR stats for monthly data and dashboard compatibility
  const prStats = calculatePRStats(prs, [], dateRange, {
    mergedField: 'pull_request.merged_at',
    getState: (pr) => pr.state,
    isMerged: (pr) => pr.state === 'closed' && pr.pull_request?.merged_at,
    isOpen: (pr) => pr.state === 'open',
    isClosed: (pr) => pr.state === 'closed' && !pr.pull_request?.merged_at,
    groupByKey: (pr) => pr._repoName || pr.repository_url?.split('/repos/')[1] || 'unknown'
  });

  const result = {
    source: 'github',
    username: username,
    // Primary metrics matching engineering-metrics format
    // Use prStats.total if contributions.totalPRs is 0 (GraphQL might miss some PRs)
    created: contributions.totalPRs > 0 ? contributions.totalPRs : prStats.total,
    reviews: contributions.totalPRReviews,     // PR reviews (totalPullRequestReviewContributions)
    // Additional metrics from contributionsCollection
    totalCommits: contributions.totalCommits,
    totalIssues: contributions.totalIssues,
    // Breakdown by repository (from contributionsCollection)
    prsByRepo: contributions.prsByRepo,
    reviewsByRepo: contributions.reviewsByRepo,
    // Legacy/dashboard fields for backwards compatibility
    total: prStats.total,
    merged: prStats.merged,
    open: prStats.open,
    closed: prStats.closed,
    avgPRsPerMonth: prStats.avgPRsPerMonth,
    monthlyPRs: prStats.monthlyPRs,
    monthlyMerged: prStats.monthlyMerged,
    reposAuthored: prStats.reposAuthored,
    repoBreakdown: prStats.repoBreakdown,
    prs: prStats.items,
    contributions: {
      totalPRReviews: contributions.totalPRReviews,
      totalCommits: contributions.totalCommits,
      reviewsByRepo: contributions.reviewsByRepo
    }
  };
  
  cache.set(cacheKey, result, 300);
  return result;
}

module.exports = {
  getStats,
  getContributionStats
};

