require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const cron = require('node-cron');
const cache = require('./utils/cache');
const githubService = require('./services/github');
const gitlabService = require('./services/gitlab');
const jiraService = require('./services/jira');
const adobeAnalyticsService = require('./services/analytics');
const { fetchProjectsWithAnalytics, fetchProjectSpecificAnalytics, fetchProjectAnalytics } = require('./routes/projects');
const { fetchLeaderboard } = require('./routes/stats');

const app = express();
const PORT = process.env.PORT || 3001;

// --- Background Cache Warmer ---
async function warmCache() {
  const startTime = Date.now();
  
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  
  const currentWorkYearStart = currentMonth >= 8 
    ? new Date(currentYear, 8, 1) 
    : new Date(currentYear - 1, 8, 1);
  
  const previousWorkYearStart = new Date(currentWorkYearStart.getFullYear() - 1, 8, 1);
  const previousWorkYearEnd = new Date(currentWorkYearStart.getFullYear(), 7, 31);
    
  const formatDate = (d) => d.getFullYear() + '-' + 
                   String(d.getMonth() + 1).padStart(2, '0') + '-' + 
                   String(d.getDate()).padStart(2, '0');
  
  const currentStartStr = formatDate(currentWorkYearStart);
  const previousStartStr = formatDate(previousWorkYearStart);
  const previousEndStr = formatDate(previousWorkYearEnd);

  const ranges = [
    { start: currentStartStr, end: null },
    { start: previousStartStr, end: previousEndStr }
  ];

  let detectedRateLimit = false;
  
  try {
    for (const range of ranges) {
      const rangeKey = JSON.stringify(range);
      
      const [githubStats, gitlabStats, jiraStats, githubReviews, gitlabReviews] = await Promise.allSettled([
        githubService.getStats(range),
        gitlabService.getStats(range),
        jiraService.getStats(range),
        githubService.getReviewComments(range),
        gitlabService.getReviewComments(range)
      ]);
      
      // Check if any requests hit rate limits
      const allResults = [githubStats, gitlabStats, jiraStats, githubReviews, gitlabReviews];
      const hasRateLimit = allResults.some(result => 
        result.status === 'rejected' && 
        (result.reason?.response?.status === 429 || result.reason?.message?.includes('429'))
      );
      
      if (hasRateLimit && !detectedRateLimit) {
        detectedRateLimit = true;
        console.warn('⚠️ Rate limiting detected, will skip leaderboard warming');
      }
      
      const statsResult = {
        github: githubStats.status === 'fulfilled' ? githubStats.value : { error: githubStats.reason?.message },
        gitlab: gitlabStats.status === 'fulfilled' ? gitlabStats.value : { error: gitlabStats.reason?.message },
        jira: jiraStats.status === 'fulfilled' ? jiraStats.value : { error: jiraStats.reason?.message },
        timestamp: new Date().toISOString()
      };
      cache.set(`stats:${rangeKey}`, statsResult, 300);
      
      const reviewStatsResult = {
        github: githubReviews.status === 'fulfilled' ? githubReviews.value : { totalComments: 0, prsReviewed: 0, avgCommentsPerPR: 0, avgReviewsPerMonth: 0, byRepo: [] },
        gitlab: gitlabReviews.status === 'fulfilled' ? gitlabReviews.value : { totalComments: 0, mrsReviewed: 0, avgCommentsPerMR: 0, avgReviewsPerMonth: 0, byRepo: [] }
      };
      
      cache.set(`stats-git:${rangeKey}`, {
        github: statsResult.github,
        gitlab: statsResult.gitlab,
        reviewStats: reviewStatsResult,
        timestamp: statsResult.timestamp
      }, 300);
      cache.set(`stats-jira:${rangeKey}`, statsResult.jira, 300);
      
      try {
        const prs = await githubService.getAllPRsForPage(range);
        const prsData = { 
          prs, 
          baseUrl: process.env.GITHUB_BASE_URL?.replace(/\/$/, '') || 'https://github.com' 
        };
        cache.set(`prs:${rangeKey}`, prsData, 300);
      } catch (e) {
        console.error('Error warming PRs:', e.message);
      }

      try {
        const mrs = await gitlabService.getAllMRsForPage(range);
        const mrsData = { 
          mrs, 
          baseUrl: process.env.GITLAB_BASE_URL?.replace(/\/$/, '') || 'https://gitlab.com' 
        };
        cache.set(`mrs:${rangeKey}`, mrsData, 300);
      } catch (e) {
        console.error('Error warming MRs:', e.message);
      }

      try {
        const issues = await jiraService.getAllIssuesForPage(range);
        const issuesData = { 
          issues, 
          baseUrl: process.env.JIRA_BASE_URL?.replace(/\/$/, '') 
        };
        cache.set(`issues:${rangeKey}`, issuesData, 120);
      } catch (e) {
        console.error('Error warming Issues:', e.message);
      }
      
      try {
        const projectsRes = await fetchProjectsWithAnalytics(range);
        cache.set(`projects-v3:${rangeKey}`, projectsRes, 300);
      } catch (e) {
        console.error('Error warming Projects:', e.message);
        // Check if projects warming hit rate limits
        if (e.message?.includes('429') || e.response?.status === 429) {
          detectedRateLimit = true;
          console.warn('⚠️ Rate limiting detected from Projects warming');
        }
      }
      
      // Skip leaderboard warming if we've detected rate limits
      // Leaderboard makes many API calls (30 users × 3 services = 90+ calls) and can easily hit rate limits
      if (!detectedRateLimit) {
        try {
          await fetchLeaderboard(range, true); // Skip cache check, always fetch fresh
        } catch (e) {
          // Don't fail the entire cache warming if leaderboard fails
          // Leaderboard is expensive and can hit rate limits
          if (e.message?.includes('429') || e.response?.status === 429) {
            detectedRateLimit = true;
            console.warn('⚠️ Leaderboard warming skipped due to rate limiting');
          } else {
            console.error('Error warming Leaderboard:', e.message);
          }
        }
      }
    }
    
    try {
      const nflKey = 'SEWEB-51747';
      const nflResult = await fetchProjectSpecificAnalytics(nflKey);
      cache.set(`project-analytics:${nflKey}`, nflResult, 600);
    } catch (err) {
      console.error('Failed to warm NFL analytics:', err.message);
    }
    
    try {
      const dkKey = 'SEWEB-59645';
      const dkResult = await fetchProjectSpecificAnalytics(dkKey);
      cache.set(`project-analytics:${dkKey}`, dkResult, 600);
    } catch (err) {
      console.error('Failed to warm DraftKings analytics:', err.message);
    }
    
    const launchDate = '2025-12-01';
    const today = new Date().toISOString().split('T')[0];
    const analyticsPresets = [
      { start: '2025-03-01', end: today },
      { start: '2025-12-01', end: today },
    ];
    
    for (const preset of analyticsPresets) {
      const dateRangeKey = `from_${preset.start}`;
      const cacheKey = `all-project-analytics-v3:${launchDate}:${dateRangeKey}`;
      
      try {
        const result = await fetchProjectAnalytics(launchDate, preset.start, preset.end);
        cache.set(cacheKey, result, 600);
      } catch (err) {
        console.error(`Failed to warm DK analytics list for ${preset.start}:`, err.message);
      }
    }
  } catch (error) {
    console.error('Cache warming failed:', error.message);
  }
}

// Schedule cache warming every 10 minutes
cron.schedule('*/10 * * * *', () => {
  warmCache();
});

// Start warming immediately on server start
setTimeout(() => {
  warmCache();
}, 5000);

// Kill any existing process on the port
function killProcessOnPort(port) {
  return new Promise((resolve) => {
    const command = process.platform === 'win32'
      ? `netstat -ano | findstr :${port} | findstr LISTENING`
      : `lsof -ti:${port}`;
    
    exec(command, (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve();
        return;
      }
      
      const pids = stdout.trim().split('\n').filter(Boolean);
      if (pids.length === 0) {
        resolve();
        return;
      }
      
      const killCommand = process.platform === 'win32'
        ? `taskkill /PID ${pids[0]} /F`
        : `kill -9 ${pids.join(' ')}`;
      
      exec(killCommand, (killError) => {
        if (killError) {
          console.error(`Could not kill process on port ${port}:`, killError.message);
        }
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
  res.json({ status: 'ok', message: 'Cache cleared' });
});

app.get('/api/clear-cache', (req, res) => {
  cache.clear();
  res.json({ status: 'ok', message: 'Cache cleared. Refresh the page to fetch fresh data.' });
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
    ENGINEERING_METRICS_USERS_URL: process.env.ENGINEERING_METRICS_USERS_URL || 'not set',
    ENGINEERING_METRICS_USERS_FILE: process.env.ENGINEERING_METRICS_USERS_FILE || 'not set',
    ENGINEERING_METRICS_PATH: process.env.ENGINEERING_METRICS_PATH || 'not set',
  });
});

// Mount API routes
const apiRoutes = require('./routes');
app.use('/api', apiRoutes);

// Start server after killing any existing process on the port
killProcessOnPort(PORT).then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
