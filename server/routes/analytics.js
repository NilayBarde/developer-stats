const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const { parseDateRange, setCacheHeaders } = require('../utils/requestHelpers');
const { createCachedEndpoint } = require('../utils/endpointHelpers');
const { generateMockNFLGamecastAnalytics } = require('../utils/mockData');
const adobeAnalyticsService = require('../services/analytics');
const { fetchProjectSpecificAnalytics } = require('./projects');

// Get Adobe Analytics data
router.get('/', createCachedEndpoint({
  cacheKeyPrefix: 'adobe-analytics',
  fetchFn: (dateRange) => adobeAnalyticsService.getAnalyticsData(dateRange),
  ttl: 300
}));

// Test Adobe Analytics authentication
router.get('/test-auth', async (req, res) => {
  try {
    const result = await adobeAnalyticsService.testAuth();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get top pages from Adobe Analytics
router.get('/top-pages', async (req, res) => {
  try {
    const searchTerm = req.query.search || null;
    const dimension = req.query.dim || 'variables/page';
    const data = await adobeAnalyticsService.getTopPages(searchTerm, dimension);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search for a specific page by name/URL
router.get('/find-page', async (req, res) => {
  try {
    const search = req.query.q;
    if (!search) {
      return res.status(400).json({ error: 'Missing ?q=search parameter' });
    }
    const data = await adobeAnalyticsService.findPage(search);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List available report suites
router.get('/report-suites', async (req, res) => {
  try {
    const data = await adobeAnalyticsService.listReportSuites();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get top click events
router.get('/clicks', async (req, res) => {
  try {
    const searchTerm = req.query.search || null;
    const data = await adobeAnalyticsService.getTopClickEvents(searchTerm);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get clicks broken down by source page
router.get('/clicks-by-source', async (req, res) => {
  try {
    const clickPage = req.query.page || 'espn:betting:interstitial';
    const data = await adobeAnalyticsService.getClicksBySource(clickPage);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get daily bet clicks for a specific page
router.get('/page-daily-clicks', async (req, res) => {
  try {
    const pageName = req.query.page;
    const startDate = req.query.startDate || '2025-03-01';
    const endDate = req.query.endDate || new Date().toISOString().split('T')[0];
    
    if (!pageName) {
      return res.status(400).json({ 
        error: 'Missing ?page= parameter',
        example: '/api/analytics/page-daily-clicks?page=espn:mlb:game:gamecast'
      });
    }
    
    const data = await adobeAnalyticsService.getPageDailyBetClicks(pageName, null, { startDate, endDate });
    res.json({
      page: pageName,
      dateRange: { startDate, endDate },
      ...data
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get clicks filtered by page token
router.get('/page-clicks', async (req, res) => {
  try {
    const launchDate = req.query.launchDate || null;
    const pageToken = req.query.pageToken || 'topeventsodds';
    const data = await adobeAnalyticsService.getOddsPageClicks(launchDate, pageToken);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get ALL bet clicks grouped by page type
router.get('/all-clicks-by-page', async (req, res) => {
  try {
    const data = await adobeAnalyticsService.getAllBetClicksByPage();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get bet clicks by actual page name
router.get('/bet-clicks-by-page-name', async (req, res) => {
  try {
    const data = await adobeAnalyticsService.getBetClicksByPageName();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Legacy endpoint - keep for backwards compatibility
router.get('/odds-page-clicks', async (req, res) => {
  try {
    const launchDate = req.query.launchDate || null;
    const data = await adobeAnalyticsService.getOddsPageClicks(launchDate, 'topeventsodds');
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get bet clicks grouped by clean page names
router.get('/bet-clicks-by-page', async (req, res) => {
  try {
    const data = await adobeAnalyticsService.getBetClicksByPage();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get bet clicks with actual page breakdown
router.get('/bet-clicks-page-breakdown', async (req, res) => {
  try {
    const data = await adobeAnalyticsService.getBetClicksWithPageBreakdown();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get bet clicks by page using inline segment
router.get('/bet-clicks-by-page-direct', async (req, res) => {
  try {
    const data = await adobeAnalyticsService.getBetClicksByPageDirect();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get top event details for a specific page
router.get('/page-event-details', async (req, res) => {
  const { page, startDate, endDate } = req.query;
  
  if (!page) {
    return res.status(400).json({ error: 'page parameter is required' });
  }
  
  try {
    const eventDetails = await adobeAnalyticsService.getPageEventDetails(
      page,
      startDate || '2025-03-01',
      endDate || new Date().toISOString().split('T')[0]
    );
    res.json(eventDetails);
  } catch (error) {
    console.error('Error fetching page event details:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get project-specific analytics
router.get('/project/:projectKey', async (req, res) => {
  const { projectKey } = req.params;
  
  if (req.query.mock === 'true') {
    console.log(`⚠ Using MOCK data for project ${projectKey}`);
    if (projectKey === 'SEWEB-51747') {
      return res.json(generateMockNFLGamecastAnalytics());
    }
    return res.json({
      project: {
        key: projectKey,
        label: `[MOCK] Project ${projectKey}`,
        description: 'Mock project data',
        launchDate: '2025-01-01'
      },
      analytics: {
        totals: { pageViews: 1000000, betClicks: 15000, conversionRate: '1.5%' }
      },
      mock: true
    });
  }
  
  delete require.cache[require.resolve('../config/projectAnalytics.json')];
  const projectConfig = require('../config/projectAnalytics.json');
  
  const project = projectConfig.projects?.find(p => p.key === projectKey);
  if (!project) {
    return res.status(404).json({ error: `Project ${projectKey} not found` });
  }

  const cacheKey = `project-analytics:${projectKey}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`✓ project-analytics:${projectKey} served from cache`);
    setCacheHeaders(res, true);
    return res.json(cached);
  }
  
  try {
    const result = await fetchProjectSpecificAnalytics(projectKey);
    
    cache.set(cacheKey, result, 600);
    setCacheHeaders(res, false);
    res.json(result);
  } catch (error) {
    console.error(`Error fetching project analytics for ${projectKey}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

