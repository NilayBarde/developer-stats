/**
 * GitHub Stats
 * 
 * Handles stats calculation using contributionsCollection and PR data.
 */

const cache = require('../../utils/cache');
const { calculatePRStats } = require('../../utils/statsHelpers');
const { graphqlQuery, CONTRIBUTIONS_QUERY, GITHUB_USERNAME, GITHUB_TOKEN } = require('./api');
const { getAllPRs } = require('./prs');

/**
 * Get contribution stats via GraphQL contributionsCollection
 */
async function getContributionStats(dateRange = null) {
  const cacheKey = `github-contributions:v2:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ GitHub contributions served from cache');
    return cached;
  }

  console.log('📦 Fetching GitHub contribution stats...');

  const to = dateRange?.end ? new Date(dateRange.end) : new Date();
  const from = dateRange?.start ? new Date(dateRange.start) : new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);

  try {
    const data = await graphqlQuery(CONTRIBUTIONS_QUERY, { 
      login: GITHUB_USERNAME, 
      from: from.toISOString(),
      to: to.toISOString()
    });
    
    const c = data.user?.contributionsCollection;
    if (!c) return null;

    const result = {
      totalPRs: c.totalPullRequestContributions,
      totalPRReviews: c.totalPullRequestReviewContributions,
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
    console.log(`  ✓ Got contributions: ${result.totalPRs} PRs, ${result.totalPRReviews} reviews`);
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
 */
async function getStats(dateRange = null) {
  if (!GITHUB_USERNAME || !GITHUB_TOKEN) {
    throw new Error('GitHub credentials not configured');
  }

  const cacheKey = `github-stats:v5:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ GitHub stats served from cache');
    return cached;
  }

  // Fetch both contributionsCollection (for engineering-metrics alignment) AND PR details (for monthly breakdown)
  const [contributions, prs] = await Promise.all([
    getContributionStats(dateRange),
    getAllPRs()
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
    username: GITHUB_USERNAME,
    // Primary metrics matching engineering-metrics format
    created: contributions.totalPRs,           // PRs created (totalPullRequestContributions)
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

