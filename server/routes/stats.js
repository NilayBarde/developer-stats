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

module.exports = router;

