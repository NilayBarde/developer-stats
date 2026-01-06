const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const { parseDateRange, setCacheHeaders } = require('../utils/requestHelpers');
const { createCachedEndpoint, createSimpleEndpoint } = require('../utils/endpointHelpers');
const { generateMockStatsData } = require('../utils/mockData');
const githubService = require('../services/github');
const gitlabService = require('../services/gitlab');
const jiraService = require('../services/jira');
const adobeAnalyticsService = require('../services/analytics');

// Get all stats (with mock support)
router.get('/', async (req, res) => {
  if (req.query.mock === 'true') {
    console.log('⚠ Using MOCK Stats data');
    return res.json(generateMockStatsData());
  }
  
  const startTime = Date.now();
  const dateRange = parseDateRange(req.query);
  const cacheKey = `stats:${JSON.stringify(dateRange)}`;
  
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ Stats served from cache');
    setCacheHeaders(res, true);
    return res.json(cached);
  }

  let timeoutCleared = false;
  const timeout = setTimeout(() => {
    if (!res.headersSent && !timeoutCleared) {
      res.status(504).json({ error: 'Request timeout' });
    }
  }, 600000);
  
  try {
    const [githubStats, gitlabStats, jiraStats] = await Promise.allSettled([
      githubService.getStats(dateRange),
      gitlabService.getStats(dateRange),
      jiraService.getStats(dateRange)
    ]);

    clearTimeout(timeout);
    timeoutCleared = true;

    if (res.headersSent) return;

    const stats = {
      github: githubStats.status === 'fulfilled' ? githubStats.value : { error: githubStats.reason?.message },
      gitlab: gitlabStats.status === 'fulfilled' ? gitlabStats.value : { error: gitlabStats.reason?.message },
      jira: jiraStats.status === 'fulfilled' ? jiraStats.value : { error: jiraStats.reason?.message },
      timestamp: new Date().toISOString()
    };

    cache.set(cacheKey, stats, 300);
    console.log(`✓ Stats fetched in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    setCacheHeaders(res, false);
    res.json(stats);
  } catch (error) {
    clearTimeout(timeout);
    timeoutCleared = true;
    if (res.headersSent) return;
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Get GitHub stats
router.get('/github', createSimpleEndpoint({
  fetchFn: (dateRange) => githubService.getStats(dateRange)
}));

// Get GitLab stats
router.get('/gitlab', createSimpleEndpoint({
  fetchFn: (dateRange) => gitlabService.getStats(dateRange)
}));

// Get Git stats (GitHub + GitLab) with mock support and smart caching
router.get('/git', async (req, res) => {
  if (req.query.mock === 'true') {
    console.log('⚠ Using MOCK Git stats');
    const mockStats = generateMockStatsData();
    return res.json({
      github: mockStats.github,
      gitlab: mockStats.gitlab,
      reviewStats: mockStats.reviewStats || {
        github: { totalComments: 142, prsReviewed: 45, avgCommentsPerPR: 3.2, avgReviewsPerMonth: 5.6, byRepo: [] },
        gitlab: { totalComments: 89, mrsReviewed: 32, avgCommentsPerMR: 2.8, avgReviewsPerMonth: 4.0, byRepo: [] }
      },
      timestamp: new Date().toISOString()
    });
  }
  
  try {
    const dateRange = parseDateRange(req.query);
    const rangeKey = JSON.stringify(dateRange);
    
    const ownCacheKey = `stats-git:${rangeKey}`;
    const cached = cache.get(ownCacheKey);
    if (cached && cached.reviewStats) {
      console.log('✓ stats/git served from own cache (with reviews)');
      setCacheHeaders(res, true);
      return res.json(cached);
    }
    
    const combinedStats = cache.get(`stats:${rangeKey}`);
    if (combinedStats && cached?.reviewStats) {
      console.log('✓ stats/git served from combined stats cache + review cache');
      setCacheHeaders(res, true);
      return res.json({
        github: combinedStats.github,
        gitlab: combinedStats.gitlab,
        reviewStats: cached.reviewStats,
        timestamp: combinedStats.timestamp
      });
    }
    
    const startTime = Date.now();
    const [githubStats, gitlabStats, githubReviews, gitlabReviews] = await Promise.allSettled([
      githubService.getStats(dateRange),
      gitlabService.getStats(dateRange),
      githubService.getReviewComments(dateRange),
      gitlabService.getReviewComments(dateRange)
    ]);
    
    const result = {
      github: githubStats.status === 'fulfilled' ? githubStats.value : { error: githubStats.reason?.message },
      gitlab: gitlabStats.status === 'fulfilled' ? gitlabStats.value : { error: gitlabStats.reason?.message },
      reviewStats: {
        github: githubReviews.status === 'fulfilled' ? githubReviews.value : { totalComments: 0, prsReviewed: 0, avgCommentsPerPR: 0, avgReviewsPerMonth: 0, byRepo: [] },
        gitlab: gitlabReviews.status === 'fulfilled' ? gitlabReviews.value : { totalComments: 0, mrsReviewed: 0, avgCommentsPerMR: 0, avgReviewsPerMonth: 0, byRepo: [] }
      },
      timestamp: new Date().toISOString()
    };
    
    cache.set(ownCacheKey, result, 300);
    console.log(`✓ stats/git fetched in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    setCacheHeaders(res, false);
    res.json(result);
  } catch (error) {
    console.error('Error fetching git stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Jira stats (with mock support and smart caching)
router.get('/jira', async (req, res) => {
  if (req.query.mock === 'true') {
    console.log('⚠ Using MOCK Jira stats');
    return res.json(generateMockStatsData().jira);
  }
  
  try {
    const dateRange = parseDateRange(req.query);
    const rangeKey = JSON.stringify(dateRange);
    
    const combinedStats = cache.get(`stats:${rangeKey}`);
    if (combinedStats && combinedStats.jira) {
      console.log('✓ stats/jira served from combined stats cache');
      setCacheHeaders(res, true);
      return res.json(combinedStats.jira);
    }
    
    const ownCacheKey = `stats-jira:${rangeKey}`;
    const cached = cache.get(ownCacheKey);
    if (cached) {
      console.log('✓ stats/jira served from own cache');
      setCacheHeaders(res, true);
      return res.json(cached);
    }
    
    const startTime = Date.now();
    const result = await jiraService.getStats(dateRange);
    
    cache.set(ownCacheKey, result, 300);
    console.log(`✓ stats/jira fetched in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    setCacheHeaders(res, false);
    res.json(result);
  } catch (error) {
    console.error('Error fetching jira stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get CTOI participation stats
router.get('/ctoi', async (req, res) => {
  try {
    const dateRange = parseDateRange(req.query);
    const cacheKey = `ctoi-stats:${JSON.stringify(dateRange)}`;
    
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log('✓ CTOI stats served from cache');
      setCacheHeaders(res, true);
      return res.json(cached);
    }
    
    const startTime = Date.now();
    const result = await jiraService.getCTOIStats(dateRange);
    
    cache.set(cacheKey, result, 300);
    console.log(`✓ CTOI stats fetched in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    setCacheHeaders(res, false);
    res.json(result);
  } catch (error) {
    console.error('Error fetching CTOI stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Adobe Analytics stats
router.get('/adobe', createSimpleEndpoint({
  fetchFn: (dateRange) => adobeAnalyticsService.getStats(dateRange)
}));

/**
 * Fetch all stats for a single user (GitHub, GitLab, Jira)
 * Uses operator tokens to query other users' stats
 */
async function fetchUserStats(user, dateRange) {
  const userId = user.id || user.github?.username || user.gitlab?.username || user.jira?.email || 'unknown';
  const userResult = {
    user: {
      id: userId,
      githubUsername: user.github?.username,
      gitlabUsername: user.gitlab?.username,
      jiraEmail: user.jira?.email
    },
    github: null,
    gitlab: null,
    jira: null,
    errors: {}
  };
  
  // Fetch all services in parallel
  const [githubStats, gitlabStats, jiraStats] = await Promise.allSettled([
    user.github?.username ? githubService.getStats(dateRange, {
      username: user.github.username,
      token: user.github.token || process.env.GITHUB_TOKEN,
      baseURL: user.github.baseURL || process.env.GITHUB_BASE_URL || 'https://github.com'
    }) : Promise.resolve(null),
    user.gitlab?.username ? gitlabService.getStats(dateRange, {
      username: user.gitlab.username,
      token: user.gitlab.token || process.env.GITLAB_TOKEN,
      baseURL: user.gitlab.baseURL || process.env.GITLAB_BASE_URL || 'https://gitlab.com'
    }) : Promise.resolve(null),
    user.jira?.email ? jiraService.getStats(dateRange, {
      email: user.jira.email,
      pat: user.jira.pat || process.env.JIRA_PAT,
      baseURL: user.jira.baseURL || process.env.JIRA_BASE_URL
    }) : Promise.resolve(null)
  ]);
  
  // Process results
  if (githubStats.status === 'fulfilled' && githubStats.value) {
    userResult.github = githubStats.value;
  } else if (githubStats.status === 'rejected') {
    console.error(`  ❌ GitHub stats failed for ${userId}:`, githubStats.reason?.message);
    userResult.errors.github = githubStats.reason?.message;
  }
  
  if (gitlabStats.status === 'fulfilled' && gitlabStats.value) {
    userResult.gitlab = gitlabStats.value;
  } else if (gitlabStats.status === 'rejected') {
    console.error(`  ❌ GitLab stats failed for ${userId}:`, gitlabStats.reason?.message);
    userResult.errors.gitlab = gitlabStats.reason?.message;
  }
  
  if (jiraStats.status === 'fulfilled' && jiraStats.value) {
    userResult.jira = jiraStats.value;
  } else if (jiraStats.status === 'rejected') {
    console.error(`  ❌ Jira stats failed for ${userId}:`, jiraStats.reason?.message);
    userResult.errors.jira = jiraStats.reason?.message;
  }
  
  return userResult;
}

// Get leaderboard stats for all users
router.get('/leaderboard', async (req, res) => {
  try {
    const dateRange = parseDateRange(req.query);
    const rangeKey = JSON.stringify(dateRange);
    
    // Load users from engineering-metrics or config file
    const { getUsers, normalizeEngineeringMetricsUser } = require('../utils/userHelpers');
    let users = await getUsers();
    
    if (!users || users.length === 0) {
      return res.json([]);
    }
    
    // Normalize users from engineering-metrics format if needed
    const processedUsers = users.map(user => normalizeEngineeringMetricsUser(user));
    
    const cacheKey = `leaderboard:${users.map(u => u.id || u.github?.username || u.gitlab?.username || u.jira?.email || 'unknown').join(',')}:${rangeKey}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log('✓ Leaderboard served from cache');
      setCacheHeaders(res, true);
      return res.json(cached);
    }
    
    const startTime = Date.now();
    console.log(`📊 Fetching leaderboard stats for ${processedUsers.length} users...`);
    
    // Process users in batches to avoid overwhelming APIs and improve perceived performance
    // Each batch processes in parallel, but batches run sequentially
    const BATCH_SIZE = 10;
    const leaderboard = [];
    
    for (let i = 0; i < processedUsers.length; i += BATCH_SIZE) {
      const batch = processedUsers.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(processedUsers.length / BATCH_SIZE);
      console.log(`  Processing batch ${batchNum}/${totalBatches} (${batch.length} users)...`);
      
      // Fetch stats for batch in parallel with timeout
      const batchPromises = batch.map(user => 
        Promise.race([
          fetchUserStats(user, dateRange),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Request timeout')), 30000) // 30s timeout per user
          )
        ]).catch(error => {
          const userId = user.id || user.github?.username || user.gitlab?.username || user.jira?.email || 'unknown';
          console.warn(`  ⚠️ Stats fetch timeout/failed for ${userId}:`, error.message);
          return {
            user: {
              id: userId,
              githubUsername: user.github?.username,
              gitlabUsername: user.gitlab?.username,
              jiraEmail: user.jira?.email
            },
            github: null,
            gitlab: null,
            jira: null,
            errors: { general: error.message || 'Request timeout' }
          };
        })
      );
      
      const batchResults = await Promise.allSettled(batchPromises);
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          leaderboard.push(result.value);
        } else {
          const user = batch[index];
          const userId = user.id || user.github?.username || user.gitlab?.username || user.jira?.email || 'unknown';
          leaderboard.push({
            user: {
              id: userId,
              githubUsername: user.github?.username,
              gitlabUsername: user.gitlab?.username,
              jiraEmail: user.jira?.email
            },
            github: null,
            gitlab: null,
            jira: null,
            errors: { general: result.reason?.message || 'Unknown error' }
          });
        }
      });
      
      console.log(`  ✓ Batch ${batchNum} complete (${((Date.now() - startTime) / 1000).toFixed(1)}s elapsed)`);
    }
    
    cache.set(cacheKey, leaderboard, 300);
    console.log(`✓ Leaderboard fetched in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    setCacheHeaders(res, false);
    res.json(leaderboard);
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard stats' });
  }
});

module.exports = router;

