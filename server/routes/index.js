const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const { createCachedEndpoint } = require('../utils/endpointHelpers');
const { setCacheHeaders } = require('../utils/requestHelpers');
const { generateMockPRsData, generateMockMRsData, generateMockIssuesData, generateMockAnalyticsData } = require('../utils/mockData');
const githubService = require('../services/github');
const gitlabService = require('../services/gitlab');
const jiraService = require('../services/jira');
const analyticsService = require('../services/analytics');

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

// Get Logbook data (aggregated timeline by month)
router.get('/logbook', async (req, res) => {
  const { startDate, endDate } = req.query;
  const useMock = req.query.mock === 'true';
  
  const dateRange = {
    start: startDate || null,
    end: endDate || null
  };
  
  const cacheKey = `logbook:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    setCacheHeaders(res, true);
    return res.json(cached);
  }

  try {
    // Fetch data from all services in parallel (reuses cached data)
    const [jiraIssues, githubPRs, gitlabMRs] = await Promise.all([
      jiraService.getAllIssuesForPage(dateRange).catch(err => {
        console.warn('Jira fetch failed:', err.message);
        return [];
      }),
      githubService.getAllPRsForPage(dateRange).catch(err => {
        console.warn('GitHub fetch failed:', err.message);
        return [];
      }),
      gitlabService.getAllMRsForPage(dateRange).catch(err => {
        console.warn('GitLab fetch failed:', err.message);
        return [];
      })
    ]);

    // Helper to get month key from date string
    const getMonthKey = (dateStr) => {
      if (!dateStr) return null;
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return null;
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    };

    // Helper to format month label
    const formatMonthLabel = (monthKey) => {
      const [year, month] = monthKey.split('-');
      const date = new Date(year, parseInt(month) - 1, 1);
      return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    };

    // Group items by month
    const monthsMap = new Map();

    // Process Jira issues (group by created date)
    const { getStoryPoints } = require('../services/jira/scope');
    for (const issue of jiraIssues) {
      // Use _inProgressDate if available, otherwise created date
      const dateToUse = issue._inProgressDate || issue.fields?.created;
      const monthKey = getMonthKey(dateToUse);
      if (!monthKey) continue;

      if (!monthsMap.has(monthKey)) {
        monthsMap.set(monthKey, {
          month: monthKey,
          label: formatMonthLabel(monthKey),
          metrics: { totalItems: 0, jiraIssues: 0, githubPRs: 0, gitlabMRs: 0, storyPoints: 0 },
          items: { jira: [], github: [], gitlab: [] }
        });
      }

      const monthData = monthsMap.get(monthKey);
      const storyPoints = getStoryPoints(issue);
      
      monthData.items.jira.push({
        key: issue.key,
        summary: issue.fields?.summary || '',
        description: issue.fields?.description || '',
        type: issue.fields?.issuetype?.name || 'Unknown',
        status: issue.fields?.status?.name || 'Unknown',
        storyPoints,
        project: issue.fields?.project?.key || '',
        created: issue.fields?.created,
        resolved: issue.fields?.resolutiondate
      });
      
      monthData.metrics.jiraIssues++;
      monthData.metrics.totalItems++;
      monthData.metrics.storyPoints += storyPoints;
    }

    // Process GitHub PRs (group by created date)
    for (const pr of githubPRs) {
      const monthKey = getMonthKey(pr.created_at);
      if (!monthKey) continue;

      if (!monthsMap.has(monthKey)) {
        monthsMap.set(monthKey, {
          month: monthKey,
          label: formatMonthLabel(monthKey),
          metrics: { totalItems: 0, jiraIssues: 0, githubPRs: 0, gitlabMRs: 0, storyPoints: 0 },
          items: { jira: [], github: [], gitlab: [] }
        });
      }

      const monthData = monthsMap.get(monthKey);
      
      monthData.items.github.push({
        id: pr.id,
        number: pr.number,
        title: pr.title || '',
        repo: pr._repoName || '',
        url: pr.html_url || '',
        state: pr.state || '',
        created: pr.created_at,
        merged: pr.merged_at || pr.pull_request?.merged_at
      });
      
      monthData.metrics.githubPRs++;
      monthData.metrics.totalItems++;
    }

    // Process GitLab MRs (group by created date)
    for (const mr of gitlabMRs) {
      const monthKey = getMonthKey(mr.created_at);
      if (!monthKey) continue;

      if (!monthsMap.has(monthKey)) {
        monthsMap.set(monthKey, {
          month: monthKey,
          label: formatMonthLabel(monthKey),
          metrics: { totalItems: 0, jiraIssues: 0, githubPRs: 0, gitlabMRs: 0, storyPoints: 0 },
          items: { jira: [], github: [], gitlab: [] }
        });
      }

      const monthData = monthsMap.get(monthKey);
      
      monthData.items.gitlab.push({
        id: mr.id,
        iid: mr.iid,
        title: mr.title || '',
        project: mr._projectPath || mr._projectName || '',
        url: mr.web_url || '',
        state: mr.state || '',
        created: mr.created_at,
        merged: mr.merged_at
      });
      
      monthData.metrics.gitlabMRs++;
      monthData.metrics.totalItems++;
    }

    // Convert to array and sort by month (most recent first)
    const months = Array.from(monthsMap.values())
      .sort((a, b) => b.month.localeCompare(a.month));

    // Calculate totals
    const totals = {
      totalItems: months.reduce((sum, m) => sum + m.metrics.totalItems, 0),
      jiraIssues: months.reduce((sum, m) => sum + m.metrics.jiraIssues, 0),
      githubPRs: months.reduce((sum, m) => sum + m.metrics.githubPRs, 0),
      gitlabMRs: months.reduce((sum, m) => sum + m.metrics.gitlabMRs, 0),
      storyPoints: months.reduce((sum, m) => sum + m.metrics.storyPoints, 0),
      monthsActive: months.length
    };

    const result = {
      months,
      totals,
      baseUrls: {
        jira: process.env.JIRA_BASE_URL?.replace(/\/$/, '') || '',
        github: process.env.GITHUB_BASE_URL?.replace(/\/$/, '') || 'https://github.com',
        gitlab: process.env.GITLAB_BASE_URL?.replace(/\/$/, '') || 'https://gitlab.com'
      }
    };

    cache.set(cacheKey, result, 300); // 5 minute cache
    setCacheHeaders(res, false);
    res.json(result);
  } catch (error) {
    console.error('Error fetching logbook data:', error);
    res.status(500).json({ error: error.message });
  }
});

// Feature to page type mapping for impact attribution
const FEATURE_PAGE_MAPPING = {
  'Bet Six Pack': ['gamecast', 'odds'],
  'Odds Strip': ['scoreboard'],
  'Odds Column': ['schedule']
};

// Get Impact Metrics (bet clicks attributed to user's features)
router.get('/impact-metrics', async (req, res) => {
  const useMock = req.query.mock === 'true';
  const launchDate = req.query.launchDate || '2024-09-01'; // ESPN Bet launch
  
  // Default to fetching ALL data since betting started (Jan 2024)
  // Can be overridden with ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
  const startDate = req.query.startDate || '2024-01-01';
  const endDate = req.query.endDate || new Date().toISOString().split('T')[0];
  
  const cacheKey = `impact-metrics:${launchDate}:${startDate}:${endDate}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    setCacheHeaders(res, true);
    return res.json(cached);
  }

  // Mock data for testing without Adobe Analytics credentials
  if (useMock) {
    // Mock: 8.5M total engagement, user's features = 7.6M (89%)
    const mockResult = {
      features: [
        { name: 'Bet Six Pack', clicks: 5200000, pages: ['gamecast', 'odds'], percentage: 61.2 }, // 5.2M / 8.5M
        { name: 'Odds Strip', clicks: 1800000, pages: ['scoreboard'], percentage: 21.2 },        // 1.8M / 8.5M
        { name: 'Odds Column', clicks: 600000, pages: ['schedule'], percentage: 7.1 }           // 0.6M / 8.5M
      ],
      totals: {
        totalClicks: 12000000,
        engagementClicks: 8500000,
        attributedClicks: 7600000,
        attributedPercentage: 89.4, // User's features = 89% of engagement
        dateRange: { start: '2024-01-01', end: endDate }
      },
      resumeBullets: [
        "Built Bet Six Pack, ESPN's core betting UI, driving 5.2M+ bet clicks (61% of engagement)",
        "Created Odds Strip on Scoreboard pages, generating 1.8M+ bet interactions (21% of engagement)",
        "Developed Odds Column for Schedule pages with 600K+ clicks (7% of engagement)"
      ],
      byLeague: [
        { league: 'NFL', totalClicks: 3500000 },
        { league: 'NBA', totalClicks: 2100000 },
        { league: 'NCAAF', totalClicks: 1200000 },
        { league: 'NHL', totalClicks: 800000 }
      ]
    };
    return res.json(mockResult);
  }

  try {
    // Use existing discoverAllBetClicks from analytics service with custom date range
    const customDateRange = { startDate, endDate };
    const betClicksData = await analyticsService.discoverAllBetClicks(launchDate, customDateRange);
    
    if (!betClicksData || betClicksData.error) {
      return res.status(500).json({ 
        error: betClicksData?.error || 'Failed to fetch bet clicks data',
        hint: 'Make sure Adobe Analytics credentials are configured'
      });
    }

    const { byPageType, totalClicks, engagementClicks, byLeague, dateRange } = betClicksData;

    // Map page types to features
    const features = [];
    let attributedClicks = 0;

    for (const [featureName, pageTypes] of Object.entries(FEATURE_PAGE_MAPPING)) {
      let featureClicks = 0;
      
      // Sum clicks from all page types that belong to this feature
      for (const pageTypeData of (byPageType || [])) {
        if (pageTypes.includes(pageTypeData.pageType)) {
          featureClicks += pageTypeData.totalClicks || 0;
        }
      }
      
      if (featureClicks > 0) {
        features.push({
          name: featureName,
          clicks: featureClicks,
          pages: pageTypes,
          percentage: 0 // Will calculate after we have total
        });
        attributedClicks += featureClicks;
      }
    }

    // Calculate percentages based on TOTAL engagement clicks (not just attributed)
    // This gives accurate "% of all betting engagement" numbers
    const baseForPercentage = engagementClicks > 0 ? engagementClicks : 1;
    features.forEach(f => {
      f.percentage = Math.round((f.clicks / baseForPercentage) * 1000) / 10;
    });
    
    // Also calculate what % of engagement the user's features account for
    const attributedPercentage = Math.round((attributedClicks / baseForPercentage) * 1000) / 10;

    // Sort by clicks descending
    features.sort((a, b) => b.clicks - a.clicks);

    // Generate resume bullets
    const formatNumber = (num) => {
      if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
      if (num >= 1000) return (num / 1000).toFixed(0) + 'K';
      return num.toString();
    };

    const resumeBullets = features.map(f => {
      const clicksFormatted = formatNumber(f.clicks);
      const pctFormatted = Math.round(f.percentage);
      
      if (f.name === 'Bet Six Pack') {
        return `Built Bet Six Pack, ESPN's core betting UI, driving ${clicksFormatted}+ bet clicks (${pctFormatted}% of betting engagement)`;
      } else if (f.name === 'Odds Strip') {
        return `Created Odds Strip on Scoreboard pages, generating ${clicksFormatted}+ bet interactions (${pctFormatted}% of engagement)`;
      } else if (f.name === 'Odds Column') {
        return `Developed Odds Column for Schedule pages with ${clicksFormatted}+ clicks (${pctFormatted}% of engagement)`;
      }
      return `${f.name}: ${clicksFormatted} clicks (${pctFormatted}%)`;
    });
    
    // Add a summary bullet about total attribution
    const attrPctFormatted = Math.round(attributedPercentage);
    resumeBullets.push(`Features I built account for ${attrPctFormatted}% of ESPN's betting engagement`);

    const result = {
      features,
      totals: {
        totalClicks: totalClicks || 0,
        engagementClicks: engagementClicks || 0,
        attributedClicks,
        attributedPercentage, // % of engagement from user's features
        dateRange: dateRange || {}
      },
      resumeBullets,
      byLeague: (byLeague || []).slice(0, 10) // Top 10 leagues
    };

    cache.set(cacheKey, result, 600); // 10 minute cache
    setCacheHeaders(res, false);
    res.json(result);
  } catch (error) {
    console.error('Error fetching impact metrics:', error);
    res.status(500).json({ 
      error: error.message,
      hint: 'Check Adobe Analytics configuration'
    });
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

