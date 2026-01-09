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

