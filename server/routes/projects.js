const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const { parseDateRange, setCacheHeaders } = require('../utils/requestHelpers');
const { generateMockProjectsData } = require('../utils/mockData');
const jiraService = require('../services/jira');

// Helper to fetch projects
async function fetchProjectsWithAnalytics(dateRange) {
  const projectsData = await jiraService.getProjectsByEpic(dateRange);
  
  return {
    ...projectsData,
    epics: projectsData.epics,
    baseUrl: process.env.JIRA_BASE_URL?.replace(/\/$/, '')
  };
}

// Get projects grouped by epic
router.get('/', async (req, res) => {
  if (req.query.mock === 'true') {
    console.log('⚠ Using MOCK Projects data');
    return res.json(generateMockProjectsData());
  }
  
  const startTime = Date.now();
  const dateRange = parseDateRange(req.query);
  const cacheKey = `projects-v3:${JSON.stringify(dateRange)}`;
  
  const cached = cache.get(cacheKey);
  if (cached) {
    setCacheHeaders(res, true);
    return res.json(cached);
  }

  try {
    const result = await fetchProjectsWithAnalytics(dateRange);
    
    cache.set(cacheKey, result, 300);
    console.log(`✓ projects-v3 fetched in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    setCacheHeaders(res, false);
    res.json(result);
  } catch (error) {
    console.error('Projects error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Export helper functions for use in other routes
module.exports = router;
module.exports.fetchProjectsWithAnalytics = fetchProjectsWithAnalytics;
