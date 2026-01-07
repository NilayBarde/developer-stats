const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const cache = require('../utils/cache');
const { parseDateRange, setCacheHeaders } = require('../utils/requestHelpers');
const { generateMockProjectsData, generateMockAnalyticsData } = require('../utils/mockData');
const jiraService = require('../services/jira');
const adobeAnalyticsService = require('../services/analytics');

// Load project analytics config
let projectAnalyticsConfig = { projects: {} };
try {
  const configPath = path.join(__dirname, '../config', 'projectAnalytics.json');
  if (fs.existsSync(configPath)) {
    projectAnalyticsConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
} catch (error) {
  console.warn('Could not load project analytics config:', error.message);
}

// Helper to fetch projects with analytics
async function fetchProjectsWithAnalytics(dateRange) {
  const projectsData = await jiraService.getProjectsByEpic(dateRange);
  
  const analyticsPromises = projectsData.epics.map(async (epic) => {
    const config = projectAnalyticsConfig.projects?.[epic.epicKey];
    if (config && config.enabled) {
      try {
        const analytics = await adobeAnalyticsService.getProjectAnalytics(config);
        return { epicKey: epic.epicKey, analytics };
      } catch (error) {
        console.error(`Analytics error for ${epic.epicKey}:`, error.message);
        return { epicKey: epic.epicKey, analytics: null };
      }
    }
    return { epicKey: epic.epicKey, analytics: null };
  });
  
  const analyticsResults = await Promise.all(analyticsPromises);
  
  const epicsWithAnalytics = projectsData.epics.map(epic => {
    const analyticsResult = analyticsResults.find(r => r.epicKey === epic.epicKey);
    return {
      ...epic,
      analytics: analyticsResult?.analytics || null
    };
  });
  
  return {
    ...projectsData,
    epics: epicsWithAnalytics,
    baseUrl: process.env.JIRA_BASE_URL?.replace(/\/$/, '')
  };
}

// Helper to fetch and process project analytics
async function fetchProjectAnalytics(launchDate, startDate, endDate) {
  const customDateRange = startDate && endDate ? { startDate, endDate } : null;
  
  const discovered = await adobeAnalyticsService.discoverAllBetClicks(launchDate, customDateRange);
  
  if (!discovered?.pages?.length) {
    return { projects: [], others: [], method: 'segment-based-discovery', totalClicks: 0 };
  }

  const projects = discovered.pages.map(page => ({
    epicKey: page.page,
    label: page.label,
    pageType: page.pageType || 'other',
    league: page.league,
    isInterstitial: page.isInterstitial,
    launchDate,
    parentProject: 'SEWEB-59645',
    parentLabel: 'DraftKings Integration',
    metricType: 'betClicks',
    clicks: {
      totalClicks: page.clicks,
      dailyClicks: page.dailyClicks || {},
      comparison: page.comparison
    }
  }));

  const grouped = {};
  const pageTypeLabels = {
    'gamecast': 'Gamecast / Match',
    'scoreboard': 'Scoreboard', 
    'odds': 'Odds',
    'futures': 'Futures',
    'fantasy': 'Fantasy',
    'fightcenter': 'MMA Fight Center',
    'watchespn': 'WatchESPN',
    'schedule': 'Schedule',
    'story': 'Stories',
    'index': 'Index Pages',
    'interstitial': 'Confirmation (Interstitial)',
    'other': 'Other Pages'
  };

  projects.forEach(project => {
    const pageType = project.pageType || 'other';
    if (!grouped[pageType]) {
      grouped[pageType] = {
        label: pageTypeLabels[pageType] || pageType,
        totalClicks: 0,
        pages: []
      };
    }
    grouped[pageType].totalClicks += project.clicks.totalClicks;
    grouped[pageType].pages.push({
      page: project.epicKey,
      label: project.label,
      league: project.league,
      clicks: project.clicks.totalClicks,
      dailyClicks: project.clicks.dailyClicks,
      comparison: project.clicks.comparison
    });
  });

  Object.values(grouped).forEach(group => {
    group.pages.sort((a, b) => b.clicks - a.clicks);
  });

  return { 
    projects,
    grouped,
    byLeague: discovered.byLeague,
    byPageType: discovered.byPageType,
    method: discovered.method || 'segment-based-discovery',
    segmentId: discovered.segmentId,
    totalClicks: discovered.totalClicks,
    engagementClicks: discovered.engagementClicks,
    interstitialClicks: discovered.interstitialClicks,
    confirmationRate: discovered.confirmationRate,
    totalPages: discovered.totalPages,
    dateRange: discovered.dateRange,
    launchDate,
    timing: discovered.timing
  };
}

// Helper to fetch project-specific analytics
async function fetchProjectSpecificAnalytics(projectKey) {
  delete require.cache[require.resolve('../config/projectAnalytics.json')];
  const projectConfig = require('../config/projectAnalytics.json');
  
  const project = projectConfig.projects?.find(p => p.key === projectKey);
  if (!project) {
    throw new Error(`Project ${projectKey} not found`);
  }

  const analysisEndDate = project.myBetsEndDate || project.endDate || null;
  
  const analytics = await adobeAnalyticsService.getProjectMetrics(
    project.pageFilter,
    project.launchDate,
    analysisEndDate,
    project.breakdownBy || null
  );
  
  return {
    project: {
      key: project.key,
      label: project.label,
      description: project.description,
      launchDate: project.launchDate,
      myBetsEndDate: project.myBetsEndDate,
      endDate: project.endDate,
      breakdownBy: project.breakdownBy,
      notes: project._notes
    },
    analytics
  };
}

// Get projects grouped by epic (with optional analytics)
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

// Get analytics for a specific project
router.get('/:epicKey/analytics', async (req, res) => {
  const { epicKey } = req.params;
  const config = projectAnalyticsConfig.projects?.[epicKey];
  
  if (!config || !config.enabled) {
    return res.status(404).json({ error: 'Analytics not configured for this project' });
  }
  
  try {
    const analytics = await adobeAnalyticsService.getProjectAnalytics(config);
    res.json(analytics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export helper functions for use in other routes
module.exports = router;
module.exports.fetchProjectsWithAnalytics = fetchProjectsWithAnalytics;
module.exports.fetchProjectAnalytics = fetchProjectAnalytics;
module.exports.fetchProjectSpecificAnalytics = fetchProjectSpecificAnalytics;

