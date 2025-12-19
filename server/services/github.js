const axios = require('axios');
const { calculatePRStats } = require('../utils/statsHelpers');

const GITHUB_USERNAME = process.env.GITHUB_USERNAME;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_BASE_URL = process.env.GITHUB_BASE_URL || 'https://github.com';

if (!GITHUB_USERNAME || !GITHUB_TOKEN) {
  console.warn('GitHub credentials not configured. GitHub stats will not be available.');
}

// Support both classic tokens (token format) and fine-grained tokens (Bearer format)
// Fine-grained tokens start with 'github_pat_' prefix
const getAuthHeader = (token) => {
  if (!token) return '';
  // Fine-grained tokens use Bearer, classic tokens use token
  return token.startsWith('github_pat_') 
    ? `Bearer ${token}`
    : `token ${token}`;
};

// Construct API base URL from GitHub base URL
// For GitHub Enterprise: https://github.company.com -> https://github.company.com/api/v3
// For GitHub.com: https://github.com -> https://api.github.com
const getApiBaseURL = (baseURL) => {
  if (baseURL === 'https://github.com' || baseURL === 'https://www.github.com') {
    return 'https://api.github.com';
  }
  // For GitHub Enterprise, API is typically at /api/v3
  return baseURL.replace(/\/$/, '') + '/api/v3';
};

const githubApi = axios.create({
  baseURL: getApiBaseURL(GITHUB_BASE_URL),
  headers: {
    'Authorization': getAuthHeader(GITHUB_TOKEN),
    'Accept': 'application/vnd.github.v3+json'
  },
  timeout: 30000
});

async function getAllPRs() {
  // Check cache for raw PRs (cache for 5 minutes)
  const cache = require('../utils/cache');
  const cacheKey = 'github-all-prs';
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ GitHub PRs served from cache');
    return cached;
  }
  
  const prsMap = new Map(); // Use Map to deduplicate PRs by ID
  
  // Fetch PRs authored by user
  let page = 1;
  let hasMore = true;
  console.log('📦 Fetching PRs authored by user...');
  while (hasMore) {
    try {
      const response = await githubApi.get('/search/issues', {
        params: {
          q: `author:${GITHUB_USERNAME} type:pr`,
          per_page: 100,
          page: page,
          sort: 'created',
          order: 'desc'
        }
      });

      if (response.data.items.length === 0) {
        hasMore = false;
      } else {
        response.data.items.forEach(pr => prsMap.set(pr.id, pr));
        page++;
        if (response.data.items.length < 100) {
          hasMore = false;
        }
        if (response.data.total && prsMap.size >= response.data.total) {
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
  
  // Fetch PRs where user commented
  page = 1;
  hasMore = true;
  console.log('📦 Fetching PRs where user commented...');
  while (hasMore) {
    try {
      const response = await githubApi.get('/search/issues', {
        params: {
          q: `commenter:${GITHUB_USERNAME} type:pr`,
          per_page: 100,
          page: page,
          sort: 'created',
          order: 'desc'
        }
      });

      if (response.data.items.length === 0) {
        hasMore = false;
      } else {
        response.data.items.forEach(pr => prsMap.set(pr.id, pr)); // Deduplicate
        page++;
        if (response.data.items.length < 100) {
          hasMore = false;
        }
        if (response.data.total && response.data.items.length < 100) {
          hasMore = false;
        }
      }
    } catch (error) {
      console.error('Error fetching PRs with comments:', error.message);
      hasMore = false;
    }
  }
  console.log(`  ✓ Found ${prsMap.size} total PRs (authored + commented)`);

  const prs = Array.from(prsMap.values());
  
  // Cache PRs for 5 minutes
  cache.set(cacheKey, prs, 300);
  return prs;
}

async function getPRComments(pr) {
  try {
    const repoUrl = pr.repository_url;
    const repoMatch = repoUrl.match(/repos\/(.+)$/);
    if (!repoMatch) return [];

    const [owner, repo] = repoMatch[1].split('/');
    const prNumber = pr.number;
    const allComments = [];
    
    // Fetch PR review comments (code comments on diffs)
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      try {
        const response = await githubApi.get(`/repos/${owner}/${repo}/pulls/${prNumber}/comments`, {
          params: {
            per_page: 100,
            page: page
          }
        });

        if (response.data.length === 0) {
          hasMore = false;
        } else {
          const userComments = response.data.filter(comment => {
            const matches = comment.user?.login?.toLowerCase() === GITHUB_USERNAME.toLowerCase();
            if (!matches && comment.user?.login && allComments.length < 10) {
              console.log(`  ⚠️ Review comment author mismatch: "${comment.user.login}" vs "${GITHUB_USERNAME}"`);
            }
            return matches;
          });
          allComments.push(...userComments);
          page++;
          if (response.data.length < 100) {
            hasMore = false;
          }
        }
      } catch (error) {
        console.error(`Error fetching PR review comments for ${prNumber}:`, error.message);
        hasMore = false;
      }
    }
    
    // Fetch PR issue comments (general discussion comments)
    // PRs are also issues, so we use the issue comments endpoint
    page = 1;
    hasMore = true;
    while (hasMore) {
      try {
        const response = await githubApi.get(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
          params: {
            per_page: 100,
            page: page
          }
        });

        if (response.data.length === 0) {
          hasMore = false;
        } else {
          const userComments = response.data.filter(comment => {
            const matches = comment.user?.login?.toLowerCase() === GITHUB_USERNAME.toLowerCase();
            if (!matches && comment.user?.login && allComments.length < 10) {
              console.log(`  ⚠️ Issue comment author mismatch: "${comment.user.login}" vs "${GITHUB_USERNAME}"`);
            }
            return matches;
          });
          allComments.push(...userComments);
          page++;
          if (response.data.length < 100) {
            hasMore = false;
          }
        }
      } catch (error) {
        console.error(`Error fetching PR issue comments for ${prNumber}:`, error.message);
        hasMore = false;
      }
    }

    return allComments;
  } catch (error) {
    console.error(`Error fetching PR comments for ${pr.number}:`, error.message);
    return [];
  }
}

async function getAllPRComments(prs, dateRange = null) {
  // Fetch comments for ALL PRs (no limit)
  // Comments will be filtered by their creation date in calculatePRStats
  // This ensures we capture comments made on any PR that fall within the date range
  // We need to check all PRs because comments can be added to old PRs
  const prsToFetch = prs; // Fetch comments for all PRs
  console.log(`📦 Fetching comments for ${prsToFetch.length} PRs...`);
  
  // Fetch comments in parallel batches to speed up
  const batchSize = 10;
  const allComments = [];
  
  for (let i = 0; i < prsToFetch.length; i += batchSize) {
    const batch = prsToFetch.slice(i, i + batchSize);
    const commentPromises = batch.map(pr => 
      getPRComments(pr).catch(error => {
        console.error(`Error fetching comments for PR ${pr.number}:`, error.message);
        return [];
      })
    );
    
    const batchComments = await Promise.all(commentPromises);
    const batchTotal = batchComments.flat().length;
    allComments.push(...batchComments.flat());
    console.log(`  ✓ Batch ${Math.floor(i / batchSize) + 1}: ${batchTotal} comments from ${batch.length} PRs`);
    
    // Small delay between batches to respect rate limits
    if (i + batchSize < prsToFetch.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  console.log(`📝 Total comments fetched: ${allComments.length} from ${prsToFetch.length} PRs`);
  return allComments;
}

async function getStats(dateRange = null) {
  const hasCredentials = GITHUB_USERNAME && GITHUB_TOKEN && 
                         GITHUB_USERNAME.trim() !== '' && 
                         GITHUB_TOKEN.trim() !== '';
  
  if (!hasCredentials) {
    throw new Error('GitHub credentials not configured. Please set GITHUB_USERNAME and GITHUB_TOKEN environment variables.');
  }

  // Check cache for stats (cache for 2 minutes)
  const cache = require('../utils/cache');
  const statsCacheKey = `github-stats:${JSON.stringify(dateRange)}`;
  const cachedStats = cache.get(statsCacheKey);
  if (cachedStats) {
    console.log('✓ GitHub stats served from cache');
    return cachedStats;
  }

  try {
    const prs = await getAllPRs();
    console.log(`📦 Fetching comments for ${prs.length} PRs...`);
    const comments = await getAllPRComments(prs, dateRange);
    
    // Debug: Log comment counts by month BEFORE filtering
    const commentsByMonthBefore = {};
    comments.forEach(comment => {
      if (comment.created_at) {
        const date = new Date(comment.created_at);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        commentsByMonthBefore[monthKey] = (commentsByMonthBefore[monthKey] || 0) + 1;
      }
    });
    console.log(`📝 Total comments fetched: ${comments.length} from ${prs.length} PRs`);
    console.log('📝 Comments by month (before date filtering):', commentsByMonthBefore);
    if (dateRange) {
      console.log('📅 Date range filter:', dateRange);
    }
    
    const stats = calculatePRStats(prs, comments, dateRange, {
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
    
    // Cache stats for 2 minutes
    cache.set(statsCacheKey, result, 120);
    
    return result;
  } catch (error) {
    console.error('❌ Error fetching GitHub stats:', error.message);
    throw error;
  }
}

async function getAllPRsForPage(dateRange = null) {
  const { filterByDateRange } = require('../utils/dateHelpers');
  
  // Get all PRs (from cache if available)
  const prs = await getAllPRs();
  
  // Filter by date range if provided
  let filteredPRs = dateRange 
    ? filterByDateRange(prs, 'created_at', dateRange)
    : prs;
  
  // Sort by updated date descending (most recent first)
  filteredPRs.sort((a, b) => {
    const dateA = new Date(a.updated_at || a.created_at || 0);
    const dateB = new Date(b.updated_at || b.created_at || 0);
    return dateB - dateA;
  });
  
  return filteredPRs;
}

module.exports = {
  getStats,
  getAllPRsForPage
};
