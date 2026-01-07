/**
 * GitHub Stats
 * 
 * Handles stats calculation using contributionsCollection and PR data.
 */

const cache = require('../../utils/cache');
const { calculatePRStats } = require('../../utils/statsHelpers');
const { graphqlQuery, CONTRIBUTIONS_QUERY, GITHUB_USERNAME, GITHUB_TOKEN, createGraphQLClient } = require('./api');
const { getAllPRs } = require('./prs');

/**
 * Get contribution stats via GraphQL contributionsCollection (like engineering-metrics)
 * Uses contributionsCollection for all metrics including PR reviews
 */
async function getContributionStats(dateRange = null, credentials = null) {
  const username = credentials?.username || GITHUB_USERNAME;
  const token = credentials?.token || GITHUB_TOKEN;
  const baseURL = credentials?.baseURL || process.env.GITHUB_BASE_URL || 'https://github.com';
  
  const cacheKey = `github-contributions:v3:${username}:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const to = dateRange?.end ? new Date(dateRange.end) : new Date();
  const from = dateRange?.start ? new Date(dateRange.start) : new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);

  try {
    // Fetch all contributions from contributionsCollection (like engineering-metrics)
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

    const result = {
      totalPRs: c.totalPullRequestContributions,
      totalPRReviews: c.totalPullRequestReviewContributions || 0,
      totalCommits: c.totalCommitContributions,
      totalIssues: c.totalIssueContributions,
      prsByRepo: c.pullRequestContributionsByRepository?.map(r => ({
        repo: r.repository.nameWithOwner,
        count: r.contributions.totalCount
      })) || [],
      reviewsByRepo: c.pullRequestReviewContributionsByRepository?.map(r => ({
        repo: r.repository.nameWithOwner,
        count: r.contributions.totalCount
      })) || []
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

  const cacheKey = `github-stats:v7:${username}:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Fetch contributionsCollection and authored PRs first
  const [contributions, authoredPRs] = await Promise.all([
    getContributionStats(dateRange, credentials),
    getAllPRs(credentials)
  ]);
  
  if (!contributions) {
    throw new Error('Failed to fetch GitHub contributions');
  }

  // Use only authored PRs for stats calculation
  const prs = authoredPRs;

  // Calculate PR stats for monthly data and dashboard compatibility
  const prStats = calculatePRStats(prs, [], dateRange, {
    mergedField: 'pull_request.merged_at',
    getState: (pr) => pr.state,
    isMerged: (pr) => {
      // PR is merged if state is 'merged' OR if merged_at exists (regardless of state)
      if (pr.state === 'merged') return true;
      if (pr.pull_request?.merged_at) return true;
      if (pr.merged_at) return true;
      return false;
    },
    isOpen: (pr) => pr.state === 'open',
    isClosed: (pr) => pr.state === 'closed' && !pr.pull_request?.merged_at && !pr.merged_at,
    groupByKey: (pr) => pr._repoName || pr.repository_url?.split('/repos/')[1] || 'unknown'
  });

  // Recalculate merged count: count PRs merged within date range (by merge date, not creation date)
  const { isInDateRange } = require('../../utils/dateHelpers');
  const allMergedPRs = prs.filter(pr => {
    if (pr.state === 'merged') return true;
    if (pr.pull_request?.merged_at) return true;
    if (pr.merged_at) return true;
    return false;
  });
  
  // Count merged PRs where merge date is within range (or no date range = all merged)
  const mergedInRange = dateRange && (dateRange.start || dateRange.end)
    ? allMergedPRs.filter(pr => {
        const mergeDate = pr.pull_request?.merged_at || pr.merged_at;
        return mergeDate && isInDateRange(mergeDate, dateRange);
      })
    : allMergedPRs;
  
  // Update merged count to use merge date filtering
  prStats.merged = mergedInRange.length;

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
    merged: prStats.merged, // PRs authored by user that were merged (filtered by merge date if date range provided)
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

