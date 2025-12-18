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
  const prs = [];
  let page = 1;
  let hasMore = true;
  const maxPages = 20; // Limit to 2000 PRs max

  while (hasMore && page <= maxPages) {
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
        prs.push(...response.data.items);
        page++;
        if (response.data.items.length < 100) {
          hasMore = false;
        }
      }
    } catch (error) {
      if (error.response?.status === 401) {
        console.error('❌ GitHub authentication failed (401 Unauthorized)');
        console.error('   Please check:');
        console.error('   1. Your GITHUB_TOKEN is correct and not expired');
        console.error('   2. Token has "repo" scope (or "public_repo" for public repos only)');
        console.error('   3. GITHUB_USERNAME matches your GitHub username exactly');
        if (error.response?.data?.message) {
          console.error(`   GitHub says: ${error.response.data.message}`);
        }
      } else {
        console.error('Error fetching GitHub PRs:', error.message);
      }
      hasMore = false;
    }
  }

  return prs;
}

async function getPRComments(pr) {
  try {
    const repoUrl = pr.repository_url;
    const repoMatch = repoUrl.match(/repos\/(.+)$/);
    if (!repoMatch) return [];

    const [owner, repo] = repoMatch[1].split('/');
    const prNumber = pr.number;
    const comments = [];
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
          const userComments = response.data.filter(comment => 
            comment.user?.login?.toLowerCase() === GITHUB_USERNAME.toLowerCase()
          );
          comments.push(...userComments);
          page++;
          if (response.data.length < 100) {
            hasMore = false;
          }
        }
      } catch (error) {
        console.error(`Error fetching PR comments for ${prNumber}:`, error.message);
        hasMore = false;
      }
    }

    return comments;
  } catch (error) {
    console.error(`Error fetching PR comments for ${pr.number}:`, error.message);
    return [];
  }
}

async function getAllPRComments(prs) {
  const limit = Math.min(prs.length, 30);
  const prsToFetch = prs.slice(0, limit);
  
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
    allComments.push(...batchComments.flat());
    
    // Small delay between batches to respect rate limits
    if (i + batchSize < prsToFetch.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return allComments;
}

async function getStats(dateRange = null) {
  const hasCredentials = GITHUB_USERNAME && GITHUB_TOKEN && 
                         GITHUB_USERNAME.trim() !== '' && 
                         GITHUB_TOKEN.trim() !== '';
  
  if (!hasCredentials) {
    throw new Error('GitHub credentials not configured. Please set GITHUB_USERNAME and GITHUB_TOKEN environment variables.');
  }

  try {
    const prs = await getAllPRs();
    const comments = await getAllPRComments(prs);
    
    const stats = calculatePRStats(prs, comments, dateRange, {
      mergedField: 'pull_request.merged_at',
      getState: (pr) => pr.state,
      isMerged: (pr) => pr.state === 'closed' && pr.pull_request?.merged_at,
      isOpen: (pr) => pr.state === 'open',
      isClosed: (pr) => pr.state === 'closed' && !pr.pull_request?.merged_at,
      groupByKey: (pr) => pr.repository_url.split('/repos/')[1] || 'unknown'
    });
    
    return {
      ...stats,
      source: 'github',
      username: GITHUB_USERNAME,
      byRepository: stats.grouped,
      prs: stats.items
    };
  } catch (error) {
    console.error('❌ Error fetching GitHub stats:', error.message);
    throw error;
  }
}

module.exports = {
  getStats
};
