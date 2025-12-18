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
  const allComments = [];
  const limit = Math.min(prs.length, 30);
  
  for (let i = 0; i < limit; i++) {
    const pr = prs[i];
    try {
      const comments = await getPRComments(pr);
      allComments.push(...comments);
      
      // Rate limiting: delay every 10 requests
      if (i % 10 === 0 && i > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error(`Error fetching comments for PR ${pr.number}:`, error.message);
    }
  }
  
  return allComments;
}

function generateMockData() {
  const prs = [];
  const comments = [];
  const { DEFAULT_START, DEFAULT_END } = require('../utils/dateHelpers');
  
  let monthIndex = 0;
  let monthIter = new Date(DEFAULT_START);
  const end = new Date(DEFAULT_END);
  const currentMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  
  while (monthIter <= currentMonth) {
    const monthDate = new Date(monthIter.getFullYear(), monthIter.getMonth(), 1);
    const prsThisMonth = Math.floor(Math.random() * 8) + 3;
    
    for (let j = 0; j < prsThisMonth; j++) {
      const day = Math.floor(Math.random() * 28) + 1;
      const createdDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
      const mergedDate = new Date(createdDate.getTime() + Math.random() * 7 * 24 * 60 * 60 * 1000);
      
      const state = Math.random() > 0.3 ? 'closed' : 'open';
      const merged = state === 'closed' && Math.random() > 0.2;
      
      prs.push({
        id: `pr-${monthIndex}-${j}`,
        number: 1000 + monthIndex * 10 + j,
        title: `Feature: Add ${['authentication', 'caching', 'logging', 'testing', 'documentation'][Math.floor(Math.random() * 5)]} module`,
        state: state,
        created_at: createdDate.toISOString(),
        pull_request: merged ? { merged_at: mergedDate.toISOString() } : {},
        repository_url: `https://api.github.com/repos/example/repo-${Math.floor(Math.random() * 3) + 1}`
      });
      
      if (Math.random() > 0.5) {
        const commentCount = Math.floor(Math.random() * 5) + 1;
        for (let k = 0; k < commentCount; k++) {
          const commentDate = new Date(createdDate.getTime() + Math.random() * (mergedDate - createdDate));
          comments.push({
            id: `comment-${monthIndex}-${j}-${k}`,
            created_at: commentDate.toISOString(),
            user: { login: 'mock-user' }
          });
        }
      }
    }
    
    monthIndex++;
    monthIter.setMonth(monthIter.getMonth() + 1);
  }
  
  return { prs, comments };
}

async function getStats(dateRange = null) {
  const hasCredentials = GITHUB_USERNAME && GITHUB_TOKEN && 
                         GITHUB_USERNAME.trim() !== '' && 
                         GITHUB_TOKEN.trim() !== '';
  
  if (!hasCredentials) {
    console.log('⚠️  Using mock GitHub data - credentials not configured');
    const { prs, comments } = generateMockData();
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
      username: 'mock-user',
      isMock: true,
      byRepository: stats.grouped
    };
  }

  console.log(`✅ Using real GitHub data for user: ${GITHUB_USERNAME}`);
  try {
    const prs = await getAllPRs();
    const comments = await getAllPRComments(prs);
    console.log(`✓ Fetched ${prs.length} PRs and ${comments.length} comments`);
    
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
      isMock: false,
      byRepository: stats.grouped,
      prs: stats.items
    };
  } catch (error) {
    console.error('❌ Error fetching GitHub stats:', error.message);
    console.error('   Falling back to mock data');
    const { prs, comments } = generateMockData();
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
      isMock: true,
      error: error.message,
      byRepository: stats.grouped,
      prs: stats.items
    };
  }
}

module.exports = {
  getStats
};
