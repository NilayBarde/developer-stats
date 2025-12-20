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
    // Set cache headers for browser caching
    res.set('Cache-Control', 'public, max-age=60'); // Browser cache for 1 minute
    res.set('X-Cache', 'HIT');
    return res.json(cached);
  }

  // Set a 10 minute timeout for the entire request (comprehensive checks can take longer)
  let timeoutCleared = false;
  const timeout = setTimeout(() => {
    if (!res.headersSent && !timeoutCleared) {
      res.status(504).json({ error: 'Request timeout - API calls taking too long' });
    }
  }, 600000); // 10 minutes
  
  try {
    const [githubStats, gitlabStats, jiraStats] = await Promise.allSettled([
      githubService.getStats(dateRange),
      gitlabService.getStats(dateRange),
      jiraService.getStats(dateRange)
    ]);

    clearTimeout(timeout);
    timeoutCleared = true;

    // Check if response was already sent (by timeout)
    if (res.headersSent) {
      return;
    }

    const stats = {
      github: githubStats.status === 'fulfilled' ? githubStats.value : { error: githubStats.reason?.message },
      gitlab: gitlabStats.status === 'fulfilled' ? gitlabStats.value : { error: gitlabStats.reason?.message },
      jira: jiraStats.status === 'fulfilled' ? jiraStats.value : { error: jiraStats.reason?.message },
      timestamp: new Date().toISOString()
    };

    // Cache the result for 2 minutes
    cache.set(cacheKey, stats, 120);

    console.log(`✓ Stats fetched in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    // Set cache headers for browser caching
    res.set('Cache-Control', 'public, max-age=60'); // Browser cache for 1 minute
    res.set('X-Cache', 'MISS');
    res.json(stats);
  } catch (error) {
    clearTimeout(timeout);
    timeoutCleared = true;
    
    // Check if response was already sent (by timeout)
    if (res.headersSent) {
      return;
    }
    
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Get GitHub stats only
app.get('/api/stats/github', async (req, res) => {
  try {
    // Parse date range from query params
    let dateRange = null;
    if (req.query.start || req.query.end) {
      dateRange = {
        start: req.query.start || null,
        end: req.query.end || null
      };
    } else if (req.query.range) {
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
    
    const stats = await githubService.getStats(dateRange);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching GitHub stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get GitLab stats only
app.get('/api/stats/gitlab', async (req, res) => {
  try {
    // Parse date range from query params
    let dateRange = null;
    if (req.query.start || req.query.end) {
      dateRange = {
        start: req.query.start || null,
        end: req.query.end || null
      };
    } else if (req.query.range) {
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
    
    const stats = await gitlabService.getStats(dateRange);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching GitLab stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Git stats (GitHub + GitLab combined)
app.get('/api/stats/git', async (req, res) => {
  try {
    // Parse date range from query params
    let dateRange = null;
    if (req.query.start || req.query.end) {
      dateRange = {
        start: req.query.start || null,
        end: req.query.end || null
      };
    } else if (req.query.range) {
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
    
    const [githubStats, gitlabStats] = await Promise.allSettled([
      githubService.getStats(dateRange),
      gitlabService.getStats(dateRange)
    ]);
    
    const stats = {
      github: githubStats.status === 'fulfilled' ? githubStats.value : { error: githubStats.reason?.message },
      gitlab: gitlabStats.status === 'fulfilled' ? gitlabStats.value : { error: gitlabStats.reason?.message },
      timestamp: new Date().toISOString()
    };
    
    res.json(stats);
  } catch (error) {
    console.error('Error fetching Git stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Jira stats only
app.get('/api/stats/jira', async (req, res) => {
  try {
    // Parse date range from query params
    let dateRange = null;
    if (req.query.start || req.query.end) {
      dateRange = {
        start: req.query.start || null,
        end: req.query.end || null
      };
    } else if (req.query.range) {
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
    
    const stats = await jiraService.getStats(dateRange);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching Jira stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all GitHub PRs for the PRs page
app.get('/api/prs', async (req, res) => {
  try {
    // Parse date range from query params
    let dateRange = null;
    if (req.query.start || req.query.end) {
      dateRange = {
        start: req.query.start || null,
        end: req.query.end || null
      };
    } else if (req.query.range) {
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
    
    // Create cache key for PRs endpoint
    const prsCacheKey = `prs:${JSON.stringify(dateRange)}`;
    const cachedPRs = cache.get(prsCacheKey);
    if (cachedPRs) {
      console.log(`✓ PRs page served from cache`);
      res.set('Cache-Control', 'public, max-age=60');
      res.set('X-Cache', 'HIT');
      return res.json(cachedPRs);
    }
    
    const startTime = Date.now();
    const prs = await githubService.getAllPRsForPage(dateRange);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✓ PRs page fetched in ${duration}s (${prs.length} PRs)`);
    
    const response = { prs, baseUrl: process.env.GITHUB_BASE_URL?.replace(/\/$/, '') || 'https://github.com' };
    
    // Cache PRs response for 2 minutes
    cache.set(prsCacheKey, response, 120);
    
    res.set('Cache-Control', 'public, max-age=60');
    res.set('X-Cache', 'MISS');
    res.json(response);
  } catch (error) {
    console.error('Error fetching GitHub PRs:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all GitLab MRs for the MRs page
app.get('/api/mrs', async (req, res) => {
  try {
    // Parse date range from query params
    let dateRange = null;
    if (req.query.start || req.query.end) {
      dateRange = {
        start: req.query.start || null,
        end: req.query.end || null
      };
    } else if (req.query.range) {
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
    
    // Create cache key for MRs endpoint
    const mrsCacheKey = `mrs:${JSON.stringify(dateRange)}`;
    const cachedMRs = cache.get(mrsCacheKey);
    if (cachedMRs) {
      console.log(`✓ MRs page served from cache`);
      res.set('Cache-Control', 'public, max-age=60');
      res.set('X-Cache', 'HIT');
      return res.json(cachedMRs);
    }
    
    const startTime = Date.now();
    const mrs = await gitlabService.getAllMRsForPage(dateRange);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✓ MRs page fetched in ${duration}s (${mrs.length} MRs)`);
    
    const response = { mrs, baseUrl: process.env.GITLAB_BASE_URL?.replace(/\/$/, '') || 'https://gitlab.com' };
    
    // Cache MRs response for 2 minutes
    cache.set(mrsCacheKey, response, 120);
    
    res.set('Cache-Control', 'public, max-age=60');
    res.set('X-Cache', 'MISS');
    res.json(response);
  } catch (error) {
    console.error('Error fetching GitLab MRs:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all Jira issues for the issues page
app.get('/api/issues', async (req, res) => {
  try {
    // Parse date range from query params
    let dateRange = null;
    if (req.query.start || req.query.end) {
      dateRange = {
        start: req.query.start || null,
        end: req.query.end || null
      };
    } else if (req.query.range) {
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
    
    // Create cache key for issues endpoint
    const issuesCacheKey = `issues:${JSON.stringify(dateRange)}`;
    const cachedIssues = cache.get(issuesCacheKey);
    if (cachedIssues) {
      console.log(`✓ Issues page served from cache`);
      res.set('Cache-Control', 'public, max-age=60'); // Browser cache for 1 minute
      res.set('X-Cache', 'HIT');
      return res.json(cachedIssues);
    }
    
    const startTime = Date.now();
    const issues = await jiraService.getAllIssuesForPage(dateRange);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✓ Issues page fetched in ${duration}s (${issues.length} issues)`);
    
    const response = { issues, baseUrl: process.env.JIRA_BASE_URL?.replace(/\/$/, '') };
    
    // Cache issues response for 2 minutes
    cache.set(issuesCacheKey, response, 120);
    
    res.set('Cache-Control', 'public, max-age=60'); // Browser cache for 1 minute
    res.set('X-Cache', 'MISS');
    res.json(response);
  } catch (error) {
    console.error('Error fetching Jira issues:', error);
    res.status(500).json({ error: error.message });
  }
});


app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

