const axios = require('axios');
const cache = require('../utils/cache');
const { calculatePRStats } = require('../utils/statsHelpers');
const { prepareItemsForPage } = require('../utils/serviceHelpers');

const GITHUB_USERNAME = process.env.GITHUB_USERNAME;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_BASE_URL = process.env.GITHUB_BASE_URL || 'https://github.com';

if (!GITHUB_USERNAME || !GITHUB_TOKEN) {
  console.warn('GitHub credentials not configured. GitHub stats will not be available.');
}

// ============================================================================
// API Client Setup
// ============================================================================

function getGraphQLURL(baseURL) {
  if (baseURL === 'https://github.com' || baseURL === 'https://www.github.com') {
    return 'https://api.github.com/graphql';
  }
  return baseURL.replace(/\/$/, '') + '/api/graphql';
}

function getRestURL(baseURL) {
  if (baseURL === 'https://github.com' || baseURL === 'https://www.github.com') {
    return 'https://api.github.com';
  }
  return baseURL.replace(/\/$/, '') + '/api/v3';
}

const githubGraphQL = axios.create({
  baseURL: getGraphQLURL(GITHUB_BASE_URL),
  headers: {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Content-Type': 'application/json'
  },
  timeout: 30000
});

const githubApi = axios.create({
  baseURL: getRestURL(GITHUB_BASE_URL),
  headers: {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json'
  },
  timeout: 30000
});

// ============================================================================
// GraphQL Helpers
// ============================================================================

async function graphqlQuery(query, variables = {}) {
  const response = await githubGraphQL.post('', { query, variables });
  if (response.data.errors) {
    throw new Error(`GraphQL error: ${response.data.errors[0]?.message}`);
  }
  return response.data.data;
}

const AUTHORED_PRS_QUERY = `
  query getAuthoredPRs($login: String!, $cursor: String) {
    user(login: $login) {
      pullRequests(first: 100, after: $cursor, orderBy: {field: CREATED_AT, direction: DESC}) {
        nodes {
          id
          number
          title
          state
          createdAt
          updatedAt
          mergedAt
          closedAt
          url
          repository {
            nameWithOwner
            url
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
        totalCount
      }
    }
  }
`;

const CONTRIBUTIONS_QUERY = `
  query getContributions($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        totalPullRequestContributions
        totalPullRequestReviewContributions
        totalCommitContributions
        totalIssueContributions
        pullRequestContributionsByRepository(maxRepositories: 100) {
          repository { nameWithOwner }
          contributions { totalCount }
        }
        pullRequestReviewContributionsByRepository(maxRepositories: 100) {
          repository { nameWithOwner }
          contributions { totalCount }
        }
      }
    }
  }
`;

// ============================================================================
// Core Data Fetching
// ============================================================================

/**
 * Fetch all PRs authored by user via GraphQL
 */
async function getAllPRs() {
  const cacheKey = 'github-prs:v3';
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ GitHub PRs served from cache');
    return cached;
  }

  const startTime = Date.now();
  console.log('📦 Fetching GitHub PRs via GraphQL...');

  const allPRs = [];
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
    const data = await graphqlQuery(AUTHORED_PRS_QUERY, { login: GITHUB_USERNAME, cursor });
    const connection = data.user?.pullRequests;
    
    if (!connection?.nodes) break;

    for (const pr of connection.nodes) {
      allPRs.push({
        id: pr.id,
        number: pr.number,
        title: pr.title,
        state: pr.state?.toLowerCase(),
        created_at: pr.createdAt,
        updated_at: pr.updatedAt,
        closed_at: pr.closedAt,
        html_url: pr.url,
        repository_url: pr.repository?.url?.replace('https://github.com', 'https://api.github.com/repos'),
        _repoName: pr.repository?.nameWithOwner,
        pull_request: { merged_at: pr.mergedAt }
      });
    }

    hasNextPage = connection.pageInfo.hasNextPage;
    cursor = connection.pageInfo.endCursor;
    
    if (allPRs.length % 200 === 0) {
      console.log(`    Fetched ${allPRs.length} PRs...`);
    }
  }

  console.log(`  ✓ Found ${allPRs.length} PRs (${Date.now() - startTime}ms)`);
  cache.set(cacheKey, allPRs, 300);
  return allPRs;
}

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

// ============================================================================
// Stats & API Functions
// ============================================================================

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

/**
 * Get all PRs for the PRs page with date filtering
 */
async function getAllPRsForPage(dateRange = null) {
  const prs = await getAllPRs();
  return prepareItemsForPage(prs, dateRange);
}

/**
 * Fetch review comments made by user on others' PRs
 * Uses GitHub Search API to find PRs where user commented
 */
async function getReviewComments(dateRange = null) {
  if (!GITHUB_USERNAME || !GITHUB_TOKEN) {
    return { totalComments: 0, prsReviewed: 0, avgCommentsPerPR: 0, avgReviewsPerMonth: 0, byRepo: [], monthlyComments: {} };
  }

  const cacheKey = `github-comments:v3:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ GitHub comments served from cache');
    return cached;
  }

  console.log('📦 Fetching GitHub review comments...');
  
  // Build search query
  let query = `commenter:${GITHUB_USERNAME} type:pr -author:${GITHUB_USERNAME}`;
  if (dateRange?.start) query += ` created:>=${dateRange.start}`;
  if (dateRange?.end) query += ` created:<=${dateRange.end}`;

  const reviewedPRs = [];
  let page = 1;

  while (page <= 10) {
    try {
      const response = await githubApi.get('/search/issues', {
        params: { q: query, per_page: 100, page, sort: 'updated', order: 'desc' }
      });

      if (response.data.items.length === 0) break;
      reviewedPRs.push(...response.data.items);
      
      if (response.data.items.length < 100 || reviewedPRs.length >= response.data.total_count) break;
      page++;
    } catch (error) {
      console.error('  Search error:', error.message);
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
          githubApi.get(`/repos/${repo}/pulls/${pr.number}/comments`, { params: { per_page: 100 } }).catch(() => ({ data: [] })),
          githubApi.get(`/repos/${repo}/issues/${pr.number}/comments`, { params: { per_page: 100 } }).catch(() => ({ data: [] }))
        ]);

        const reviewComments = (reviewRes.data || []).filter(c => c.user?.login === GITHUB_USERNAME).length;
        const issueComments = (issueRes.data || []).filter(c => c.user?.login === GITHUB_USERNAME).length;
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

  const result = {
    totalComments,
    prsReviewed,
    avgCommentsPerPR,
    avgReviewsPerMonth: Math.round((prsReviewed / Math.max(1, commentsByMonth.size)) * 10) / 10,
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
  getStats,
  getAllPRsForPage,
  getReviewComments,
  getContributionStats
};
