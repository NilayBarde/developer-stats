// Load environment variables FIRST before requiring services
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cache = require('./utils/cache');
const githubService = require('./services/github');
const gitlabService = require('./services/gitlab');
const jiraService = require('./services/jira');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Debug endpoint to check environment variables (without exposing tokens)
app.get('/api/debug/env', (req, res) => {
  res.json({
    GITLAB_USERNAME: process.env.GITLAB_USERNAME ? 'set' : 'not set',
    GITLAB_TOKEN: process.env.GITLAB_TOKEN ? 'set' : 'not set',
    GITLAB_BASE_URL: process.env.GITLAB_BASE_URL || 'not set',
    GITHUB_USERNAME: process.env.GITHUB_USERNAME ? 'set' : 'not set',
    GITHUB_TOKEN: process.env.GITHUB_TOKEN ? 'set' : 'not set',
    JIRA_PAT: process.env.JIRA_PAT ? 'set' : 'not set',
    JIRA_BASE_URL: process.env.JIRA_BASE_URL || 'not set',
  });
});

// Get all stats with timeout
app.get('/api/stats', async (req, res) => {
  const startTime = Date.now();
  
  // Parse date range from query params
  let dateRange = null;
  if (req.query.start || req.query.end) {
    dateRange = {
      start: req.query.start || null,
      end: req.query.end || null
    };
  } else if (req.query.range) {
    // Handle dynamic ranges like "last6months", "last12months", "alltime"
    const now = new Date();
    switch(req.query.range) {
      case 'last6months':
        const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);
        dateRange = { start: sixMonthsAgo.toISOString().split('T')[0], end: null };
        break;
      case 'last12months':
        const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 12, 1);
        dateRange = { start: twelveMonthsAgo.toISOString().split('T')[0], end: null };
        break;
      case 'alltime':
        dateRange = { start: null, end: null };
        break;
    }
  }
  
  // Create cache key from date range
  const cacheKey = `stats:${JSON.stringify(dateRange)}`;
  
  // Check cache first (cache for 2 minutes)
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`✓ Stats served from cache`);
    return res.json(cached);
  }

  // Set a 2 minute timeout for the entire request
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({ error: 'Request timeout - API calls taking too long' });
    }
  }, 120000); // 2 minutes
  
  try {
    const [githubStats, gitlabStats, jiraStats] = await Promise.allSettled([
      githubService.getStats(dateRange),
      gitlabService.getStats(dateRange),
      jiraService.getStats(dateRange)
    ]);

    clearTimeout(timeout);

    const stats = {
      github: githubStats.status === 'fulfilled' ? githubStats.value : { error: githubStats.reason?.message },
      gitlab: gitlabStats.status === 'fulfilled' ? gitlabStats.value : { error: gitlabStats.reason?.message },
      jira: jiraStats.status === 'fulfilled' ? jiraStats.value : { error: jiraStats.reason?.message },
      timestamp: new Date().toISOString()
    };

    // Cache the result for 2 minutes
    cache.set(cacheKey, stats, 120);

    console.log(`✓ Stats fetched in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    res.json(stats);
  } catch (error) {
    clearTimeout(timeout);
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Get GitHub stats only
app.get('/api/stats/github', async (req, res) => {
  try {
    const stats = await githubService.getStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching GitHub stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get GitLab stats only
app.get('/api/stats/gitlab', async (req, res) => {
  try {
    const stats = await gitlabService.getStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching GitLab stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Jira stats only
app.get('/api/stats/jira', async (req, res) => {
  try {
    const stats = await jiraService.getStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching Jira stats:', error);
    res.status(500).json({ error: error.message });
  }
});


app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

