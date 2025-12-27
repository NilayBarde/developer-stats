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

// Support both classic tokens (token format) and fine-grained tokens (Bearer format)
function getAuthHeader(token) {
  if (!token) return '';
  return token.startsWith('github_pat_') ? `Bearer ${token}` : `token ${token}`;
}

// Construct API base URL from GitHub base URL
function getApiBaseURL(baseURL) {
  if (baseURL === 'https://github.com' || baseURL === 'https://www.github.com') {
    return 'https://api.github.com';
  }
  return baseURL.replace(/\/$/, '') + '/api/v3';
}

const githubApi = axios.create({
  baseURL: getApiBaseURL(GITHUB_BASE_URL),
  headers: {
    'Authorization': getAuthHeader(GITHUB_TOKEN),
    'Accept': 'application/vnd.github.v3+json'
  },
  timeout: 30000
});

/**
 * Fetch all PRs authored by user
 */
async function getAllPRs() {
  const cacheKey = 'github-all-prs:v2';
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ GitHub PRs served from cache');
    return cached;
  }
  
  const prsMap = new Map();
  let page = 1;
  let hasMore = true;
  
  console.log('📦 Fetching PRs authored by user...');
  
  while (hasMore) {
    try {
      const response = await githubApi.get('/search/issues', {
        params: {
          q: `author:${GITHUB_USERNAME} type:pr`,
          per_page: 100,
          page,
          sort: 'created',
          order: 'desc'
        }
      });

      if (response.data.items.length === 0) {
        hasMore = false;
      } else {
        response.data.items.forEach(pr => prsMap.set(pr.id, pr));
        page++;
        if (response.data.items.length < 100 || prsMap.size >= response.data.total) {
          hasMore = false;
        }
      }
    } catch (error) {
      if (error.response?.status === 401) {
        console.error('❌ GitHub authentication failed (401 Unauthorized)');
      } else {
        console.error('Error fetching authored PRs:', error.message);
      }
      hasMore = false;
    }
  }
  
  console.log(`  ✓ Found ${prsMap.size} PRs authored by user`);

  const prs = Array.from(prsMap.values());
  cache.set(cacheKey, prs, 300);
  return prs;
}

/**
 * Get GitHub stats with optional date range filtering
 */
async function getStats(dateRange = null) {
  const hasCredentials = GITHUB_USERNAME && GITHUB_TOKEN && 
                         GITHUB_USERNAME.trim() !== '' && 
                         GITHUB_TOKEN.trim() !== '';
  
  if (!hasCredentials) {
    throw new Error('GitHub credentials not configured. Please set GITHUB_USERNAME and GITHUB_TOKEN environment variables.');
  }

  const statsCacheKey = `github-stats:${JSON.stringify(dateRange)}`;
  const cachedStats = cache.get(statsCacheKey);
  if (cachedStats) {
    console.log('✓ GitHub stats served from cache');
    return cachedStats;
  }

  try {
    const prs = await getAllPRs();
    
    const stats = calculatePRStats(prs, [], dateRange, {
      mergedField: 'pull_request.merged_at',
      getState: (pr) => pr.state,
      isMerged: (pr) => pr.state === 'closed' && pr.pull_request?.merged_at,
      isOpen: (pr) => pr.state === 'open',
      isClosed: (pr) => pr.state === 'closed' && !pr.pull_request?.merged_at,
      groupByKey: (pr) => pr.repository_url.split('/repos/')[1] || 'unknown'
    });
    
    const result = {
      ...stats,
      source: 'github',
      username: GITHUB_USERNAME,
      byRepository: stats.grouped,
      prs: stats.items
    };
    
    cache.set(statsCacheKey, result, 300);
    return result;
  } catch (error) {
    console.error('❌ Error fetching GitHub stats:', error.message);
    throw error;
  }
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
 * Uses GitHub Search API to find PRs where user commented but didn't author
 */
async function getReviewComments(dateRange = null) {
  const hasCredentials = GITHUB_USERNAME && GITHUB_TOKEN && 
                         GITHUB_USERNAME.trim() !== '' && 
                         GITHUB_TOKEN.trim() !== '';
  
  if (!hasCredentials) {
    return { totalComments: 0, prsReviewed: 0, avgCommentsPerPR: 0, avgReviewsPerMonth: 0, byRepo: [] };
  }

  const cacheKey = `github-review-comments:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ GitHub review comments served from cache');
    return cached;
  }

  console.log('📦 Fetching GitHub PRs where user commented...');
  
  // Build search query - PRs where user is a commenter but not author
  let query = `commenter:${GITHUB_USERNAME} type:pr -author:${GITHUB_USERNAME}`;
  
  // Add date range to query if specified
  if (dateRange?.start) {
    query += ` created:>=${dateRange.start}`;
  }
  if (dateRange?.end) {
    query += ` created:<=${dateRange.end}`;
  }

  const reviewedPRs = [];
  let page = 1;
  let hasMore = true;
  let totalCount = 0;

  while (hasMore) {
    try {
      const response = await githubApi.get('/search/issues', {
        params: {
          q: query,
          per_page: 100,
          page,
          sort: 'updated',
          order: 'desc'
        }
      });

      totalCount = response.data.total_count || 0;
      
      if (response.data.items.length === 0) {
        hasMore = false;
      } else {
        reviewedPRs.push(...response.data.items);
        page++;
        if (response.data.items.length < 100 || reviewedPRs.length >= totalCount) {
          hasMore = false;
        }
        // Limit to reasonable number of pages
        if (page > 10) hasMore = false;
      }
    } catch (error) {
      if (error.response?.status === 401) {
        console.error('❌ GitHub authentication failed (401 Unauthorized)');
      } else {
        console.error('Error fetching review comments:', error.message);
      }
      hasMore = false;
    }
  }

  console.log(`  ✓ Found ${reviewedPRs.length} PRs reviewed (total: ${totalCount})`);

  // Group PRs by repo first (this is fast, no API calls)
  const commentsByRepo = new Map();
  const commentsByMonth = new Map();
  
  for (const pr of reviewedPRs) {
    const repoMatch = pr.repository_url?.match(/repos\/(.+)$/);
    const repo = repoMatch ? repoMatch[1] : 'unknown';
    
    if (!commentsByRepo.has(repo)) {
      commentsByRepo.set(repo, { repo, comments: 0, prsReviewed: 0 });
    }
    commentsByRepo.get(repo).prsReviewed++;
    
    // Group by month
    const month = pr.created_at?.substring(0, 7) || 'unknown';
    if (!commentsByMonth.has(month)) {
      commentsByMonth.set(month, { prs: 0, comments: 0 });
    }
    commentsByMonth.get(month).prs++;
  }

  // Sample a subset of PRs to estimate average comments per PR
  // This avoids making hundreds of API calls
  const sampleSize = Math.min(30, reviewedPRs.length);
  const samplePRs = reviewedPRs.slice(0, sampleSize);
  let sampleComments = 0;
  
  console.log(`  → Sampling ${sampleSize} PRs for comment counts...`);
  
  // Process in parallel batches
  const batchSize = 5;
  for (let i = 0; i < samplePRs.length; i += batchSize) {
    const batch = samplePRs.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(async (pr) => {
      try {
        const repoMatch = pr.repository_url?.match(/repos\/(.+)$/);
        const repo = repoMatch ? repoMatch[1] : null;
        if (!repo) return 0;

        // Fetch both review comments and issue comments
        const [reviewCommentsRes, issueCommentsRes] = await Promise.all([
          githubApi.get(`/repos/${repo}/pulls/${pr.number}/comments`, { params: { per_page: 100 } }).catch(() => ({ data: [] })),
          githubApi.get(`/repos/${repo}/issues/${pr.number}/comments`, { params: { per_page: 100 } }).catch(() => ({ data: [] }))
        ]);

        const userReviewComments = (reviewCommentsRes.data || []).filter(c => c.user?.login === GITHUB_USERNAME).length;
        const userIssueComments = (issueCommentsRes.data || []).filter(c => c.user?.login === GITHUB_USERNAME).length;
        return userReviewComments + userIssueComments;
      } catch {
        return 1; // Assume at least 1 comment since they appeared in search
      }
    }));
    
    sampleComments += batchResults.reduce((sum, count) => sum + count, 0);
    
    // Small delay between batches
    if (i + batchSize < samplePRs.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // Estimate total comments based on sample
  const avgCommentsPerPR = sampleSize > 0 ? Math.round((sampleComments / sampleSize) * 10) / 10 : 1;
  const prsReviewed = reviewedPRs.length;
  const totalComments = Math.round(prsReviewed * avgCommentsPerPR);
  
  // Update repo stats with estimated comments
  const byRepo = Array.from(commentsByRepo.values()).map(r => ({
    ...r,
    comments: Math.round(r.prsReviewed * avgCommentsPerPR)
  })).sort((a, b) => b.comments - a.comments);
  
  // Calculate avg reviews per month
  const numMonths = commentsByMonth.size || 1;
  const avgReviewsPerMonth = Math.round((prsReviewed / numMonths) * 10) / 10;
  
  console.log(`  ✓ ${prsReviewed} PRs reviewed, ~${totalComments} comments (avg ${avgCommentsPerPR}/PR)`);

  const result = {
    totalComments,
    prsReviewed,
    avgCommentsPerPR,
    avgReviewsPerMonth,
    byRepo,
    // Estimate monthly comments based on PRs per month * avg comments per PR
    monthlyComments: Object.fromEntries(
      Array.from(commentsByMonth.entries()).map(([month, data]) => [month, Math.round((data.prs || 0) * avgCommentsPerPR)])
    )
  };

  cache.set(cacheKey, result, 300);
  console.log(`  ✓ ${prsReviewed} PRs reviewed with ${totalComments} comments`);
  
  return result;
}

module.exports = {
  getStats,
  getAllPRsForPage,
  getReviewComments
};
