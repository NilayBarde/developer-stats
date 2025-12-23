require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cache = require('./utils/cache');
const { parseDateRange, setCacheHeaders } = require('./utils/requestHelpers');
const { createCachedEndpoint, createSimpleEndpoint } = require('./utils/endpointHelpers');
const githubService = require('./services/github');
const gitlabService = require('./services/gitlab');
const jiraService = require('./services/jira');
const adobeAnalyticsService = require('./services/adobeAnalytics');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
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

// Get projects grouped by epic
app.get('/api/projects', createCachedEndpoint({
  cacheKeyPrefix: 'projects-v2', // Changed prefix to invalidate old cache
  fetchFn: (dateRange) => jiraService.getProjectsByEpic(dateRange),
  ttl: 300,
  transformResponse: (data) => ({
    ...data,
    baseUrl: process.env.JIRA_BASE_URL?.replace(/\/$/, '')
  })
}));

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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
