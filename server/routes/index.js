const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const { createCachedEndpoint } = require('../utils/endpointHelpers');
const { setCacheHeaders } = require('../utils/requestHelpers');
const { generateMockPRsData, generateMockMRsData, generateMockIssuesData, generateMockAnalyticsData } = require('../utils/mockData');
const githubService = require('../services/github');
const gitlabService = require('../services/gitlab');
const jiraService = require('../services/jira');

// Import route modules
const statsRoutes = require('./stats');
const analyticsRoutes = require('./analytics');
const projectsRoutes = require('./projects');
const { fetchProjectAnalytics } = require('./projects');

// Mount route modules
router.use('/stats', statsRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/projects', projectsRoutes);

// Get GitHub PRs
router.get('/prs', (req, res, next) => {
  if (req.query.mock === 'true') {
    console.log('⚠ Using MOCK PRs data');
    return res.json(generateMockPRsData());
  }
  return createCachedEndpoint({
    cacheKeyPrefix: 'prs',
    fetchFn: (dateRange) => githubService.getAllPRsForPage(dateRange),
    ttl: 300,
    transformResponse: (prs) => ({
      prs,
      baseUrl: process.env.GITHUB_BASE_URL?.replace(/\/$/, '') || 'https://github.com'
    })
  })(req, res, next);
});

// Get GitLab MRs
router.get('/mrs', (req, res, next) => {
  if (req.query.mock === 'true') {
    console.log('⚠ Using MOCK MRs data');
    return res.json(generateMockMRsData());
  }
  return createCachedEndpoint({
    cacheKeyPrefix: 'mrs',
    fetchFn: (dateRange) => gitlabService.getAllMRsForPage(dateRange),
    ttl: 300,
    transformResponse: (mrs) => ({
      mrs,
      baseUrl: process.env.GITLAB_BASE_URL?.replace(/\/$/, '') || 'https://gitlab.com'
    })
  })(req, res, next);
});

// Get Jira issues
router.get('/issues', (req, res, next) => {
  if (req.query.mock === 'true') {
    console.log('⚠ Using MOCK Issues data');
    return res.json(generateMockIssuesData());
  }
  return createCachedEndpoint({
    cacheKeyPrefix: 'issues',
    fetchFn: (dateRange) => jiraService.getAllIssuesForPage(dateRange),
    ttl: 120,
    transformResponse: (issues) => ({
      issues,
      baseUrl: process.env.JIRA_BASE_URL?.replace(/\/$/, '')
    })
  })(req, res, next);
});

// Get all project analytics (for Analytics page) - AUTO-DISCOVERS pages with bet clicks
router.get('/project-analytics', async (req, res) => {
  const launchDate = req.query.launchDate || '2025-12-01';
  const startDate = req.query.startDate;
  const endDate = req.query.endDate;
  const useMock = req.query.mock === 'true';
  
  if (useMock) {
    console.log('⚠ Using MOCK data (mock=true)');
    const mockResult = generateMockAnalyticsData(startDate, endDate, launchDate);
    return res.json(mockResult);
  }
  
  const dateRangeKey = startDate ? `from_${startDate}` : 'default';
  const cacheKey = `all-project-analytics-v3:${launchDate}:${dateRangeKey}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ Project analytics served from cache');
    setCacheHeaders(res, true);
    return res.json(cached);
  }

  try {
    const result = await fetchProjectAnalytics(launchDate, startDate, endDate);
    
    cache.set(cacheKey, result, 600);
    setCacheHeaders(res, false);
    res.json(result);
  } catch (error) {
    console.error('Error in project-analytics:', error);
    res.status(500).json({ error: error.message });
  }
});

// Clear cache endpoint
router.post('/cache/clear', (req, res) => {
  const { prefix } = req.body;
  if (prefix) {
    cache.deleteByPrefix(prefix);
    res.json({ message: `Cache cleared for prefix: ${prefix}` });
  } else {
    cache.clear();
    res.json({ message: 'All cache cleared' });
  }
});

module.exports = router;

