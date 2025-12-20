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
  // v2: Only includes authored PRs (commented PRs disabled)
  const cache = require('../utils/cache');
  const cacheKey = 'github-all-prs:v2';
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
  
  // COMMENTED PRS DISABLED - Set to true to include PRs where user commented but didn't author
  const INCLUDE_COMMENTED_PRS = false;
  
  if (INCLUDE_COMMENTED_PRS) {
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
  } else {
    console.log(`  ✓ Skipping PRs where user commented (INCLUDE_COMMENTED_PRS disabled)`);
    console.log(`  ✓ Found ${prsMap.size} total PRs (authored only)`);
  }

  const prs = Array.from(prsMap.values());
  
  // Cache PRs for 5 minutes
  cache.set(cacheKey, prs, 300);
  return prs;
}

async function getStats(dateRange = null) {
  const hasCredentials = GITHUB_USERNAME && GITHUB_TOKEN && 
                         GITHUB_USERNAME.trim() !== '' && 
                         GITHUB_TOKEN.trim() !== '';
  
  if (!hasCredentials) {
    throw new Error('GitHub credentials not configured. Please set GITHUB_USERNAME and GITHUB_TOKEN environment variables.');
  }

  // Check cache for stats (cache for 5 minutes)
  const cache = require('../utils/cache');
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
      // Only count as merged if PR is closed AND has merged_at timestamp (not just closed)
      isMerged: (pr) => pr.state === 'closed' && pr.pull_request?.merged_at,
      isOpen: (pr) => pr.state === 'open',
      // Count as closed only if closed but NOT merged (closed without merged_at)
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
    
    // Cache stats for 5 minutes
    cache.set(statsCacheKey, result, 300);
    
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
