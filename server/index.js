require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const cache = require('./utils/cache');
const { parseDateRange, setCacheHeaders } = require('./utils/requestHelpers');
const { createCachedEndpoint, createSimpleEndpoint } = require('./utils/endpointHelpers');
const githubService = require('./services/github');
const gitlabService = require('./services/gitlab');
const jiraService = require('./services/jira');
const adobeAnalyticsService = require('./services/adobeAnalytics');
const { 
  generateMockAnalyticsData, 
  generateMockPRsData, 
  generateMockMRsData, 
  generateMockIssuesData, 
  generateMockProjectsData,
  generateMockStatsData,
  generateMockNFLGamecastAnalytics
} = require('./utils/mockData');

const app = express();
const PORT = process.env.PORT || 3001;

// Kill any existing process on the port
function killProcessOnPort(port) {
  return new Promise((resolve) => {
    const command = process.platform === 'win32'
      ? `netstat -ano | findstr :${port} | findstr LISTENING`
      : `lsof -ti:${port}`;
    
    exec(command, (error, stdout) => {
      if (error || !stdout.trim()) {
        // No process found on port
        resolve();
        return;
      }
      
      const pids = stdout.trim().split('\n').filter(Boolean);
      if (pids.length === 0) {
        resolve();
        return;
      }
      
      console.log(`Found existing process(es) on port ${port}: ${pids.join(', ')}`);
      
      const killCommand = process.platform === 'win32'
        ? `taskkill /PID ${pids[0]} /F`
        : `kill -9 ${pids.join(' ')}`;
      
      exec(killCommand, (killError) => {
        if (killError) {
          console.log(`Could not kill process: ${killError.message}`);
        } else {
          console.log(`Killed process(es) on port ${port}`);
        }
        // Small delay to ensure port is released
        setTimeout(resolve, 100);
      });
    });
  });
}

app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Clear all caches
app.post('/api/clear-cache', (req, res) => {
  cache.clear();
  console.log('🗑️ Cache cleared');
  res.json({ status: 'ok', message: 'Cache cleared' });
});

// Debug endpoint
app.get('/api/debug/env', (req, res) => {
  res.json({
    GITLAB_USERNAME: process.env.GITLAB_USERNAME ? 'set' : 'not set',
    GITLAB_TOKEN: process.env.GITLAB_TOKEN ? 'set' : 'not set',
    GITLAB_BASE_URL: process.env.GITLAB_BASE_URL || 'not set',
    GITHUB_USERNAME: process.env.GITHUB_USERNAME ? 'set' : 'not set',
    GITHUB_TOKEN: process.env.GITHUB_TOKEN ? 'set' : 'not set',
    JIRA_PAT: process.env.JIRA_PAT ? 'set' : 'not set',
    JIRA_BASE_URL: process.env.JIRA_BASE_URL || 'not set',
    ADOBE_CLIENT_ID: process.env.ADOBE_CLIENT_ID ? 'set' : 'not set',
    ADOBE_CLIENT_SECRET: process.env.ADOBE_CLIENT_SECRET ? 'set' : 'not set',
    ADOBE_ORG_ID: process.env.ADOBE_ORG_ID ? 'set' : 'not set',
    ADOBE_TECHNICAL_ACCOUNT_ID: process.env.ADOBE_TECHNICAL_ACCOUNT_ID ? 'set' : 'not set',
    ADOBE_TECHNICAL_ACCOUNT_EMAIL: process.env.ADOBE_TECHNICAL_ACCOUNT_EMAIL ? 'set' : 'not set',
    ADOBE_PRIVATE_KEY: process.env.ADOBE_PRIVATE_KEY ? 'set' : 'not set',
    ADOBE_REPORT_SUITE_ID: process.env.ADOBE_REPORT_SUITE_ID || 'not set',
  });
});

// Get all stats (with mock support)
app.get('/api/stats', async (req, res) => {
  // Mock data support
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
app.get('/api/stats/github', createSimpleEndpoint({
  fetchFn: (dateRange) => githubService.getStats(dateRange)
}));

// Get GitLab stats
app.get('/api/stats/gitlab', createSimpleEndpoint({
  fetchFn: (dateRange) => gitlabService.getStats(dateRange)
}));

// Get Git stats (GitHub + GitLab) with mock support
app.get('/api/stats/git', (req, res, next) => {
  if (req.query.mock === 'true') {
    console.log('⚠ Using MOCK Git stats');
    const mockStats = generateMockStatsData();
    return res.json({
      github: mockStats.github,
      gitlab: mockStats.gitlab,
      timestamp: new Date().toISOString()
    });
  }
  return createSimpleEndpoint({
    fetchFn: async (dateRange) => {
      const [githubStats, gitlabStats] = await Promise.allSettled([
        githubService.getStats(dateRange),
        gitlabService.getStats(dateRange)
      ]);
      
      return {
        github: githubStats.status === 'fulfilled' ? githubStats.value : { error: githubStats.reason?.message },
        gitlab: gitlabStats.status === 'fulfilled' ? gitlabStats.value : { error: gitlabStats.reason?.message },
        timestamp: new Date().toISOString()
      };
    }
  })(req, res, next);
});

// Get Jira stats (with mock support)
app.get('/api/stats/jira', (req, res, next) => {
  if (req.query.mock === 'true') {
    console.log('⚠ Using MOCK Jira stats');
    return res.json(generateMockStatsData().jira);
  }
  return createSimpleEndpoint({
    fetchFn: (dateRange) => jiraService.getStats(dateRange)
  })(req, res, next);
});

// Get GitHub PRs
// Get GitHub PRs (with mock support)
app.get('/api/prs', (req, res, next) => {
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

// Get GitLab MRs (with mock support)
app.get('/api/mrs', (req, res, next) => {
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

// Get Jira issues (with mock support)
app.get('/api/issues', (req, res, next) => {
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

// Load project analytics config
const fs = require('fs');
const path = require('path');
let projectAnalyticsConfig = { projects: {} };
try {
  const configPath = path.join(__dirname, 'config', 'projectAnalytics.json');
  if (fs.existsSync(configPath)) {
    projectAnalyticsConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
} catch (error) {
  console.warn('Could not load project analytics config:', error.message);
}

// Get projects grouped by epic (with optional analytics)
app.get('/api/projects', async (req, res) => {
  // Mock data support
  if (req.query.mock === 'true') {
    console.log('⚠ Using MOCK Projects data');
    return res.json(generateMockProjectsData());
  }
  
  const startTime = Date.now();
  const dateRange = parseDateRange(req.query);
  const cacheKey = `projects-v3:${JSON.stringify(dateRange)}`;
  
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ projects-v3 served from cache');
    setCacheHeaders(res, true);
    return res.json(cached);
  }

  try {
    // Get Jira projects
    const projectsData = await jiraService.getProjectsByEpic(dateRange);
    
    // Fetch analytics for configured projects (in parallel)
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
    
    // Merge analytics into epics
    const epicsWithAnalytics = projectsData.epics.map(epic => {
      const analyticsResult = analyticsResults.find(r => r.epicKey === epic.epicKey);
      return {
        ...epic,
        analytics: analyticsResult?.analytics || null
      };
    });
    
    const result = {
      ...projectsData,
      epics: epicsWithAnalytics,
      baseUrl: process.env.JIRA_BASE_URL?.replace(/\/$/, '')
    };
    
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
app.get('/api/projects/:epicKey/analytics', async (req, res) => {
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

// Get all project analytics (for Analytics page) - AUTO-DISCOVERS pages with bet clicks
app.get('/api/project-analytics', async (req, res) => {
  const launchDate = req.query.launchDate || '2025-12-01'; // DraftKings launch date
  const startDate = req.query.startDate; // Optional custom start date
  const endDate = req.query.endDate; // Optional custom end date
  const useMock = req.query.mock === 'true'; // Use mock data for dev
  
  // Mock data for development (avoids API rate limits)
  if (useMock) {
    console.log('⚠ Using MOCK data (mock=true)');
    const mockResult = generateMockAnalyticsData(startDate, endDate, launchDate);
    return res.json(mockResult);
  }
  
  // Build cache key with date range
  const dateRangeKey = startDate && endDate ? `${startDate}_${endDate}` : 'default';
  const cacheKey = `all-project-analytics-v3:${launchDate}:${dateRangeKey}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ Project analytics served from cache');
    setCacheHeaders(res, true);
    return res.json(cached);
  }

  try {
    // Build custom date range if provided
    const customDateRange = startDate && endDate ? { startDate, endDate } : null;
    
    // Auto-discover all pages with bet clicks using segment
    const discovered = await adobeAnalyticsService.discoverAllBetClicks(launchDate, customDateRange);
    
    if (!discovered?.pages?.length) {
      return res.json({ projects: [], others: [], method: 'segment-based-discovery', totalClicks: 0 });
    }

    // Format ALL pages for charts
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

    // Group pages by pageType (excluding interstitials from main groups)
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

    // Sort pages within each group by clicks
    Object.values(grouped).forEach(group => {
      group.pages.sort((a, b) => b.clicks - a.clicks);
    });

    const result = { 
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
    
    cache.set(cacheKey, result, 600); // Cache for 10 minutes
    setCacheHeaders(res, false);
    res.json(result);
  } catch (error) {
    console.error('Error in project-analytics:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get top event details for a specific page
app.get('/api/analytics/page-event-details', async (req, res) => {
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

// Get project-specific analytics (Next Gen Gamecast, etc.)
app.get('/api/analytics/project/:projectKey', async (req, res) => {
  const { projectKey } = req.params;
  
  // Mock data support for NFL Gamecast
  if (req.query.mock === 'true') {
    console.log(`⚠ Using MOCK data for project ${projectKey}`);
    if (projectKey === 'SEWEB-51747') {
      return res.json(generateMockNFLGamecastAnalytics());
    }
    // Return generic mock for other projects
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
  
  // Clear require cache to pick up config changes
  delete require.cache[require.resolve('./config/projectAnalytics.json')];
  const projectConfig = require('./config/projectAnalytics.json');
  
  // Find project config
  const project = projectConfig.projects?.find(p => p.key === projectKey);
  if (!project) {
    return res.status(404).json({ error: `Project ${projectKey} not found` });
  }
  
  try {
    // Use myBetsEndDate for the analysis period (when My Bets was active)
    const analysisEndDate = project.myBetsEndDate || project.endDate || null;
    
    const analytics = await adobeAnalyticsService.getProjectMetrics(
      project.pageFilter,
      project.launchDate,
      analysisEndDate,
      project.breakdownBy || null
    );
    
    res.json({
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
    });
  } catch (error) {
    console.error(`Error fetching project analytics for ${projectKey}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Helper to format page names into readable labels
function formatPageLabel(pageName) {
  // "espn:nfl:game:gamecast" -> "NFL Gamecast"
  // "espn:nba:schedule" -> "NBA Schedule"
  const parts = pageName.replace('espn:', '').split(':');
  
  const sportMap = {
    'nfl': 'NFL', 'nba': 'NBA', 'nhl': 'NHL', 'mlb': 'MLB',
    'ncaaf': 'College Football', 'ncaab': 'College Basketball',
    'soccer': 'Soccer', 'mma': 'MMA', 'golf': 'Golf',
    'tennis': 'Tennis', 'boxing': 'Boxing', 'f1': 'F1'
  };
  
  const pageTypeMap = {
    'scoreboard': 'Scoreboard', 'schedule': 'Schedule', 
    'gamecast': 'Gamecast', 'odds': 'Odds',
    'standings': 'Standings', 'stats': 'Stats',
    'scores': 'Scores', 'game': '', 'match': ''
  };

  let sport = sportMap[parts[0]?.toLowerCase()] || parts[0]?.toUpperCase() || '';
  let pageType = '';
  
  // Find the page type in the parts
  for (const part of parts.slice(1)) {
    if (pageTypeMap[part.toLowerCase()] !== undefined) {
      if (pageTypeMap[part.toLowerCase()]) {
        pageType = pageTypeMap[part.toLowerCase()];
      }
    }
  }
  
  if (!pageType && parts.length > 1) {
    pageType = parts[parts.length - 1].charAt(0).toUpperCase() + parts[parts.length - 1].slice(1);
  }

  return `${sport} ${pageType}`.trim() || pageName;
}

// Debug: Get top pages from Adobe Analytics (to find the right filter)
app.get('/api/analytics/top-pages', async (req, res) => {
  try {
    const searchTerm = req.query.search || null;
    const dimension = req.query.dim || 'variables/page';
    const data = await adobeAnalyticsService.getTopPages(searchTerm, dimension);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug: Search for a specific page by name/URL
app.get('/api/analytics/find-page', async (req, res) => {
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
app.get('/api/analytics/report-suites', async (req, res) => {
  try {
    const data = await adobeAnalyticsService.listReportSuites();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get top click events (for discovering click tracking data)
app.get('/api/analytics/clicks', async (req, res) => {
  try {
    const searchTerm = req.query.search || null;
    const data = await adobeAnalyticsService.getTopClickEvents(searchTerm);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get clicks broken down by source page
app.get('/api/analytics/clicks-by-source', async (req, res) => {
  try {
    const clickPage = req.query.page || 'espn:betting:interstitial';
    const data = await adobeAnalyticsService.getClicksBySource(clickPage);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug: Get daily bet clicks for a specific page (to see when clicks actually happened)
app.get('/api/analytics/page-daily-clicks', async (req, res) => {
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

// Get clicks filtered by page token (e.g., topeventsodds, gamecast, scoreboard)
app.get('/api/analytics/page-clicks', async (req, res) => {
  try {
    const launchDate = req.query.launchDate || null;
    const pageToken = req.query.pageToken || 'topeventsodds';
    const data = await adobeAnalyticsService.getOddsPageClicks(launchDate, pageToken);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get ALL bet clicks grouped by page type (fast)
app.get('/api/analytics/all-clicks-by-page', async (req, res) => {
  try {
    const data = await adobeAnalyticsService.getAllBetClicksByPage();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get bet clicks by actual page name (exact pages)
app.get('/api/analytics/bet-clicks-by-page-name', async (req, res) => {
  try {
    const data = await adobeAnalyticsService.getBetClicksByPageName();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// TEST: Multi-column Page × Day matrix (ONE API call!)
app.get('/api/analytics/test-page-day-matrix', async (req, res) => {
  try {
    const numDays = parseInt(req.query.days) || 7;
    const data = await adobeAnalyticsService.testPageDayMatrix(numDays);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Legacy endpoint - keep for backwards compatibility
app.get('/api/analytics/odds-page-clicks', async (req, res) => {
  try {
    const launchDate = req.query.launchDate || null;
    const data = await adobeAnalyticsService.getOddsPageClicks(launchDate, 'topeventsodds');
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug: Explore all dimensions available for bet clicks
// Usage: /api/analytics/explore-bet-clicks?dim=variables/page (or evar67, pagename, etc)
app.get('/api/analytics/explore-bet-clicks', async (req, res) => {
  try {
    const dimension = req.query.dim || 'variables/page';
    const data = await adobeAnalyticsService.exploreBetClickDimension(dimension);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get bet clicks grouped by clean page names (parsed from evar67)
app.get('/api/analytics/bet-clicks-by-page', async (req, res) => {
  try {
    const data = await adobeAnalyticsService.getBetClicksByPage();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get bet clicks with actual page breakdown (shows real page name where click occurred)
app.get('/api/analytics/bet-clicks-page-breakdown', async (req, res) => {
  try {
    const data = await adobeAnalyticsService.getBetClicksWithPageBreakdown();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Explore ALL attributes available for bet click events
app.get('/api/analytics/bet-click-attributes', async (req, res) => {
  try {
    const data = await adobeAnalyticsService.exploreBetClickAttributes();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Explore correlation between ambiguous evar67 values and actual page (to get league)
// This breaks down bet clicks like "football:game:gamecast" by the actual page dimension
// to determine if they're NFL, NCAAF, etc.
app.get('/api/analytics/evar67-league-correlation', async (req, res) => {
  try {
    const data = await adobeAnalyticsService.exploreEvar67LeagueCorrelation();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List all dimensions in the report suite (find c.league, c.sport mappings)
app.get('/api/analytics/dimensions', async (req, res) => {
  try {
    const data = await adobeAnalyticsService.listAllDimensions();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Find evars/props that contain league/sport values
app.get('/api/analytics/find-league-sport-vars', async (req, res) => {
  try {
    const data = await adobeAnalyticsService.findLeagueSportVars();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get bet clicks by page using inline segment (attempts to properly filter to bet clicks)
app.get('/api/analytics/bet-clicks-by-page-direct', async (req, res) => {
  try {
    const data = await adobeAnalyticsService.getBetClicksByPageDirect();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Adobe Analytics stats
app.get('/api/stats/adobe', createSimpleEndpoint({
  fetchFn: (dateRange) => adobeAnalyticsService.getStats(dateRange)
}));

// Get Adobe Analytics data
app.get('/api/analytics', createCachedEndpoint({
  cacheKeyPrefix: 'adobe-analytics',
  fetchFn: (dateRange) => adobeAnalyticsService.getAnalyticsData(dateRange),
  ttl: 300
}));

// Test Adobe Analytics authentication
app.get('/api/analytics/test-auth', async (req, res) => {
  try {
    const result = await adobeAnalyticsService.testAuth();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clear cache endpoint (useful for debugging)
app.post('/api/cache/clear', (req, res) => {
  const { prefix } = req.body;
  if (prefix) {
    cache.deleteByPrefix(prefix);
    res.json({ message: `Cache cleared for prefix: ${prefix}` });
  } else {
    cache.clear();
    res.json({ message: 'All cache cleared' });
  }
});

// Pre-warm cache function - auto-discovers pages with bet clicks
async function prewarmCache() {
  console.log('🔥 Pre-warming cache (auto-discovery mode)...');
  
  try {
    const launchDate = '2025-12-01';
    const startTime = Date.now();
    
    // Use new discoverAllBetClicks which does everything in one call
    console.log('  → Discovering all pages with bet clicks from evar67...');
    const discovered = await adobeAnalyticsService.discoverAllBetClicks(launchDate);
    
    if (discovered?.pages?.length) {
      // Format and cache results - use all pages from discovery
      const projects = discovered.pages.map(page => ({
        epicKey: page.page,
        label: page.label,
        launchDate,
        parentProject: 'SEWEB-59645',
        parentLabel: 'DraftKings Integration',
        metricType: 'betClicks',
        clicks: {
          totalClicks: page.clicks,
          draftKingsClicks: page.draftKingsClicks,
          espnBetClicks: page.espnBetClicks,
          dailyClicks: page.dailyClicks || {},
          comparison: page.comparison
        }
      }));

      const result = { 
        projects,
        grouped: discovered.grouped,
        pageTypes: discovered.pageTypes,
        method: discovered.method,
        totalClicks: discovered.totalClicks,
        totalPages: discovered.totalPages,
        dateRange: discovered.dateRange,
        launchDate
      };
      
      cache.set(`all-project-analytics-v2:${launchDate}`, result, 600);
      
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  ✓ Found ${discovered.pages.length} pages with ${discovered.totalClicks.toLocaleString()} clicks in ${elapsed}s`);
    } else {
      console.log('  ⚠ No pages with bet clicks found');
    }
  } catch (error) {
    console.error('  ✗ Pre-warm failed:', error.message);
  }
}

// Start server after killing any existing process on the port
killProcessOnPort(PORT).then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    
    // Pre-warm cache disabled - data is cached on first request anyway
    // To re-enable: uncomment the lines below
    // setTimeout(() => {
    //   prewarmCache();
    // }, 1000);
  });
});
