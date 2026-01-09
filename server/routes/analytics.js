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

// Get list of all tracked projects
router.get('/projects', async (req, res) => {
  try {
    delete require.cache[require.resolve('../config/projectAnalytics.json')];
    const projectConfig = require('../config/projectAnalytics.json');
    
    const projects = projectConfig.projects || [];
    
    // Map projects to the format expected by the frontend
    const mappedProjects = projects.map(project => {
      // Determine route based on project key or use a default pattern
      let route;
      if (project.key === 'SEWEB-59645') {
        route = '/analytics/draftkings';
      } else if (project.key === 'SEWEB-51747') {
        route = '/analytics/nfl-gamecast';
      } else {
        // Default: convert key to route (e.g., SEWEB-12345 -> /analytics/seweb-12345)
        route = `/analytics/${project.key.toLowerCase().replace(/-/g, '-')}`;
      }
      
      // Map metrics array to display format (capitalize first letter of each word)
      const metrics = (project.metrics || []).map(metric => {
        // Convert camelCase to Title Case (e.g., "pageViews" -> "Page Views", "betClicks" -> "Bet Clicks")
        return metric
          .replace(/([A-Z])/g, ' $1')
          .replace(/^./, str => str.toUpperCase())
          .trim();
      });
      
      // Provide default description if missing
      let description = project.description || '';
      if (!description && project.key === 'SEWEB-59645') {
        description = 'Bet clicks tracking across all ESPN pages with DraftKings integration.';
      }
      
      return {
        key: project.key,
        label: project.label,
        description: description,
        launchDate: project.launchDate,
        endDate: project.endDate || project.myBetsEndDate || null,
        route: route,
        metrics: metrics.length > 0 ? metrics : (project.key === 'SEWEB-59645' 
          ? ['Bet Clicks', 'Page Breakdown', 'Daily Trends']
          : ['Page Views', 'Bet Clicks', 'Conversion Rate'])
      };
    });
    
    res.json({
      projects: mappedProjects
    });
  } catch (error) {
    console.error('Error fetching projects list:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get project-specific analytics
router.get('/project/:projectKey', async (req, res) => {
  const { projectKey } = req.params;
  
  if (req.query.mock === 'true') {
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

// Historical bracket page analysis
router.get('/bracket-impact', async (req, res) => {
  try {
    const { apiRequest, ADOBE_REPORT_SUITE_ID } = require('../services/analytics/api');
    
    /**
     * Query bracket page metrics for a specific date range
     */
    async function getBracketMetrics(startDate, endDate) {
      const globalFilters = [{
        type: 'dateRange',
        dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
      }];

      const data = await apiRequest('/reports', {
        method: 'POST',
        data: {
          rsid: ADOBE_REPORT_SUITE_ID,
          globalFilters,
          metricContainer: {
            metrics: [
              { id: 'metrics/pageviews', columnId: '0' },
              { id: 'metrics/visitors', columnId: '1' },
              { id: 'metrics/visits', columnId: '2' }
            ]
          },
          dimension: 'variables/page',
          search: { clause: `CONTAINS 'bracket'` },
          settings: { countRepeatInstances: true, limit: 500 }
        }
      });

      const pages = (data?.rows || [])
        .filter(row => {
          const pageName = (row.value || '').toLowerCase();
          // Only include ESPN bracket pages, not fantasy bracket games
          return pageName.includes('bracket') && 
                 !pageName.includes('fantasy') &&
                 (pageName.startsWith('espn:') || pageName.startsWith('espnau:') || 
                  pageName.startsWith('espnuk:') || pageName.startsWith('espnmx:') ||
                  pageName.startsWith('espnbr:') || pageName.startsWith('espnph:') ||
                  pageName.startsWith('espnin:') || pageName.startsWith('espnza:') ||
                  pageName.startsWith('espnww:'));
        })
        .map(row => ({
          page: row.value,
          pageViews: row.data?.[0] || 0,
          visitors: row.data?.[1] || 0,
          visits: row.data?.[2] || 0
        }))
        .sort((a, b) => b.pageViews - a.pageViews);

      const totals = pages.reduce((acc, p) => ({
        pageViews: acc.pageViews + p.pageViews,
        visitors: acc.visitors + p.visitors,
        visits: acc.visits + p.visits
      }), { pageViews: 0, visitors: 0, visits: 0 });

      return { dateRange: { start: startDate, end: endDate }, pages, totals, pageCount: pages.length };
    }

    // Define time periods to analyze
    const periods = [
      // March Madness comparison (most relevant since redesign was Feb 2023)
      { name: 'March Madness 2022 (Pre-redesign)', start: '2022-03-14', end: '2022-04-05' },
      { name: 'March Madness 2023 (Post-redesign)', start: '2023-03-14', end: '2023-04-04' },
      { name: 'March Madness 2024', start: '2024-03-17', end: '2024-04-08' },
      { name: 'March Madness 2025', start: '2025-03-16', end: '2025-04-07' },
      
      // NBA Playoffs
      { name: 'NBA Playoffs 2023', start: '2023-04-15', end: '2023-06-15' },
      { name: 'NBA Playoffs 2024', start: '2024-04-16', end: '2024-06-15' },
      { name: 'NBA Playoffs 2025', start: '2025-04-19', end: '2025-06-15' },
      
      // NFL Playoffs
      { name: 'NFL Playoffs Jan 2023', start: '2023-01-14', end: '2023-02-12' },
      { name: 'NFL Playoffs Jan 2024', start: '2024-01-13', end: '2024-02-11' },
      { name: 'NFL Playoffs Jan 2025', start: '2025-01-11', end: '2025-02-09' },
      
      // College Football Playoffs
      { name: 'CFP 2022-23', start: '2022-12-31', end: '2023-01-10' },
      { name: 'CFP 2023-24', start: '2023-12-30', end: '2024-01-09' },
      { name: 'CFP 2024-25', start: '2024-12-20', end: '2025-01-20' },
      
      // MLB Playoffs
      { name: 'MLB Playoffs 2023', start: '2023-10-01', end: '2023-11-05' },
      { name: 'MLB Playoffs 2024', start: '2024-10-01', end: '2024-11-03' },
      
      // NHL Playoffs
      { name: 'NHL Playoffs 2023', start: '2023-04-17', end: '2023-06-15' },
      { name: 'NHL Playoffs 2024', start: '2024-04-20', end: '2024-06-25' },
    ];

    const results = [];
    
    for (const period of periods) {
      try {
        const metrics = await getBracketMetrics(period.start, period.end);
        results.push({ period: period.name, ...metrics });
      } catch (err) {
        results.push({ period: period.name, error: err.message, dateRange: { start: period.start, end: period.end } });
      }
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // Calculate totals across all measured periods
    const totalPageViews = results.reduce((sum, r) => sum + (r.totals?.pageViews || 0), 0);
    const totalVisitors = results.reduce((sum, r) => sum + (r.totals?.visitors || 0), 0);
    
    // Find biggest events
    const sortedByViews = results
      .filter(r => !r.error && r.totals?.pageViews > 0)
      .sort((a, b) => b.totals.pageViews - a.totals.pageViews);

    // Calculate YoY growth for March Madness
    const mm2022 = results.find(r => r.period.includes('2022') && r.period.includes('March'));
    const mm2023 = results.find(r => r.period.includes('2023') && r.period.includes('March'));
    const mm2024 = results.find(r => r.period.includes('2024') && r.period.includes('March'));
    
    let marchMadnessGrowth = null;
    if (mm2022?.totals?.pageViews > 0 && mm2023?.totals?.pageViews > 0) {
      marchMadnessGrowth = {
        preRedesign: mm2022.totals.pageViews,
        postRedesign: mm2023.totals.pageViews,
        growthPercent: Math.round(((mm2023.totals.pageViews - mm2022.totals.pageViews) / mm2022.totals.pageViews) * 100)
      };
    }

    // Generate resume bullets
    const formatNumber = (num) => {
      if (!num) return '0';
      if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
      if (num >= 1000) return Math.round(num / 1000) + 'K';
      return num.toString();
    };

    const resumeBullets = [];
    
    if (totalPageViews > 0) {
      resumeBullets.push(`Redesigned ESPN's bracket visualization pages for March Madness, NFL/NBA/MLB/NHL Playoffs, and College Football Playoffs, generating ${formatNumber(totalPageViews)}+ pageviews across major sporting events`);
    }
    
    if (sortedByViews[0]) {
      resumeBullets.push(`Built bracket pages that drove ${formatNumber(sortedByViews[0].totals.pageViews)} pageviews during ${sortedByViews[0].period.replace(/\s*\(.*\)/, '')}`);
    }
    
    if (marchMadnessGrowth && marchMadnessGrowth.growthPercent > 0) {
      resumeBullets.push(`Improved March Madness bracket engagement by ${marchMadnessGrowth.growthPercent}% year-over-year following February 2023 redesign`);
    }
    
    if (totalVisitors > 1000000) {
      resumeBullets.push(`Bracket pages served ${formatNumber(totalVisitors)} unique visitors across all measured tournament periods`);
    }

    res.json({
      summary: {
        totalPageViews,
        totalVisitors,
        periodsAnalyzed: results.length,
        successfulQueries: results.filter(r => !r.error).length
      },
      marchMadnessGrowth,
      topEvents: sortedByViews.slice(0, 5).map(e => ({
        period: e.period,
        pageViews: e.totals.pageViews,
        visitors: e.totals.visitors,
        topPages: e.pages.slice(0, 3)
      })),
      resumeBullets,
      allPeriods: results
    });
  } catch (error) {
    console.error('Bracket impact analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

