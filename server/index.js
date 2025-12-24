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

const app = express();

// Generate mock analytics data for development (avoids API rate limits)
function generateMockAnalyticsData(startDate, endDate, launchDate) {
  const start = startDate || '2025-03-01';
  const end = endDate || new Date().toISOString().split('T')[0];
  const launch = launchDate || '2025-12-01';
  
  // Mock pages with realistic data
  const mockPages = [
    { page: 'mlb:gamecast', label: 'MLB Gamecast', baseClicks: 250000 },
    { page: 'nfl:gamecast', label: 'NFL Gamecast', baseClicks: 220000 },
    { page: 'nba:gamecast', label: 'NBA Gamecast', baseClicks: 180000 },
    { page: 'nfl:schedule', label: 'NFL Schedule', baseClicks: 150000 },
    { page: 'nfl:odds', label: 'NFL Odds', baseClicks: 140000 },
    { page: 'ncaaf:gamecast', label: 'College Football Gamecast', baseClicks: 120000 },
    { page: 'ncaab:gamecast', label: 'College Basketball Gamecast', baseClicks: 100000 },
    { page: 'soccer:gamecast', label: 'Soccer Gamecast', baseClicks: 80000 },
    { page: 'nhl:gamecast', label: 'NHL Gamecast', baseClicks: 70000 },
    { page: 'mlb:schedule', label: 'MLB Schedule', baseClicks: 60000 },
  ];
  
  // Generate daily data
  const generateDailyClicks = (baseClicks, startStr, endStr, launchStr) => {
    const dailyClicks = {};
    const startD = new Date(startStr);
    const endD = new Date(endStr);
    const launchD = new Date(launchStr);
    const days = Math.ceil((endD - startD) / (1000 * 60 * 60 * 24));
    const avgPerDay = Math.round(baseClicks / days);
    
    let beforeTotal = 0, afterTotal = 0;
    let beforeDays = 0, afterDays = 0;
    
    for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
      const variance = 0.5 + Math.random();
      const clicks = Math.round(avgPerDay * variance);
      const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      dailyClicks[dateStr] = { clicks };
      
      if (d < launchD) {
        beforeTotal += clicks;
        beforeDays++;
      } else {
        afterTotal += clicks;
        afterDays++;
      }
    }
    
    return {
      dailyClicks,
      comparison: {
        avgClicksBefore: beforeDays > 0 ? Math.round(beforeTotal / beforeDays) : 0,
        avgClicksAfter: afterDays > 0 ? Math.round(afterTotal / afterDays) : 0
      }
    };
  };
  
  // Build projects
  const projects = mockPages.map(p => {
    const { dailyClicks, comparison } = generateDailyClicks(p.baseClicks, start, end, launch);
    const totalClicks = Object.values(dailyClicks).reduce((sum, d) => sum + d.clicks, 0);
    
    return {
      epicKey: p.page,
      label: p.label,
      pageType: p.page.split(':')[1] || 'other',
      launchDate: launch,
      metricType: 'betClicks',
      clicks: {
        totalClicks,
        dailyClicks,
        comparison
      }
    };
  });
  
  // Group by page type
  const grouped = {};
  projects.forEach(project => {
    const pageType = project.pageType;
    if (!grouped[pageType]) {
      grouped[pageType] = {
        label: `📄 ${pageType.charAt(0).toUpperCase() + pageType.slice(1)} Pages`,
        totalClicks: 0,
        pages: []
      };
    }
    grouped[pageType].totalClicks += project.clicks.totalClicks;
    grouped[pageType].pages.push({
      page: project.epicKey,
      label: project.label,
      clicks: project.clicks.totalClicks,
      dailyClicks: project.clicks.dailyClicks,
      comparison: project.clicks.comparison
    });
  });
  
  return {
    projects,
    grouped,
    method: 'MOCK DATA (mock=true)',
    totalClicks: projects.reduce((sum, p) => sum + p.clicks.totalClicks, 0),
    totalPages: projects.length,
    dateRange: { start, end },
    launchDate: launch,
    timing: { totalSeconds: 0, note: 'Mock data - instant' }
  };
}
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

// Get all stats
app.get('/api/stats', async (req, res) => {
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

// Get Git stats (GitHub + GitLab)
app.get('/api/stats/git', createSimpleEndpoint({
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
}));

// Get Jira stats
app.get('/api/stats/jira', createSimpleEndpoint({
  fetchFn: (dateRange) => jiraService.getStats(dateRange)
}));

// Get GitHub PRs
app.get('/api/prs', createCachedEndpoint({
  cacheKeyPrefix: 'prs',
  fetchFn: (dateRange) => githubService.getAllPRsForPage(dateRange),
  ttl: 300,
  transformResponse: (prs) => ({
    prs,
    baseUrl: process.env.GITHUB_BASE_URL?.replace(/\/$/, '') || 'https://github.com'
  })
}));

// Get GitLab MRs
app.get('/api/mrs', createCachedEndpoint({
  cacheKeyPrefix: 'mrs',
  fetchFn: (dateRange) => gitlabService.getAllMRsForPage(dateRange),
  ttl: 300,
  transformResponse: (mrs) => ({
    mrs,
    baseUrl: process.env.GITLAB_BASE_URL?.replace(/\/$/, '') || 'https://gitlab.com'
  })
}));

// Get Jira issues
app.get('/api/issues', createCachedEndpoint({
  cacheKeyPrefix: 'issues',
  fetchFn: (dateRange) => jiraService.getAllIssuesForPage(dateRange),
  ttl: 120,
  transformResponse: (issues) => ({
    issues,
    baseUrl: process.env.JIRA_BASE_URL?.replace(/\/$/, '')
  })
}));

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
    
    // Auto-discover all pages with bet clicks from evar67
    const discovered = await adobeAnalyticsService.discoverAllBetClicks(launchDate, customDateRange);
    
    if (!discovered?.pages?.length) {
      return res.json({ projects: [], others: [], method: 'auto-discovery', totalClicks: 0 });
    }

    // Format ALL pages for charts, grouped by page type
    const projects = discovered.pages.map(page => ({
      epicKey: page.page,
      label: page.label,
      pageType: page.page.split(':')[1] || 'other',
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
      method: 'auto-discovery from evar67 (event_detail)',
      totalClicks: discovered.totalClicks,
      totalPages: discovered.totalPages,
      dateRange: discovered.dateRange,
      launchDate,
      timing: discovered.timing // Include timing info for client progress estimates
    };
    
    cache.set(cacheKey, result, 600); // Cache for 10 minutes
    setCacheHeaders(res, false);
    res.json(result);
  } catch (error) {
    console.error('Error in project-analytics:', error);
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
