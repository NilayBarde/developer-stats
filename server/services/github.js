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

module.exports = {
  getStats,
  getAllPRsForPage
};
