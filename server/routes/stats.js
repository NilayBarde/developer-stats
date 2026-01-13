const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const { parseDateRange, setCacheHeaders } = require('../utils/requestHelpers');
const { createCachedEndpoint, createSimpleEndpoint } = require('../utils/endpointHelpers');
const { generateMockStatsData } = require('../utils/mockData');
const githubService = require('../services/github');
const gitlabService = require('../services/gitlab');
const jiraService = require('../services/jira');

// Get all stats (with mock support)
router.get('/', async (req, res) => {
  if (req.query.mock === 'true') {
    return res.json(generateMockStatsData());
  }
  
  const dateRange = parseDateRange(req.query);
  const cacheKey = `stats:${JSON.stringify(dateRange)}`;
  
  const cached = cache.get(cacheKey);
  if (cached) {
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

// Debug endpoint for GitHub contributions
router.get('/github/debug', async (req, res) => {
  try {
    const dateRange = parseDateRange(req.query);
    const { getContributionStats } = require('../services/github/stats');
    const result = await getContributionStats(dateRange);
    
    res.json({
      dateRange,
      username: process.env.GITHUB_USERNAME,
      baseURL: process.env.GITHUB_BASE_URL || 'https://github.com',
      result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      error: error.message, 
      stack: error.stack,
      username: process.env.GITHUB_USERNAME,
      baseURL: process.env.GITHUB_BASE_URL || 'https://github.com'
    });
  }
});

// Debug endpoint to check a specific PR for reviews
router.get('/github/pr/:owner/:repo/:number', async (req, res) => {
  try {
    const { owner, repo, number } = req.params;
    const { githubApi } = require('../services/github/api');
    
    const repoPath = `${owner}/${repo}`;
    
    // Fetch PR reviews
    const reviewsRes = await githubApi.get(`/repos/${repoPath}/pulls/${number}/reviews`).catch(() => ({ data: [] }));
    const reviews = reviewsRes.data || [];
    
    // Fetch PR comments
    const commentsRes = await githubApi.get(`/repos/${repoPath}/pulls/${number}/comments`).catch(() => ({ data: [] }));
    const comments = commentsRes.data || [];
    
    // Fetch issue comments
    const issueCommentsRes = await githubApi.get(`/repos/${repoPath}/issues/${number}/comments`).catch(() => ({ data: [] }));
    const issueComments = issueCommentsRes.data || [];
    
    const username = process.env.GITHUB_USERNAME;
    
    // Filter for current user
    const userReviews = reviews.filter(r => r.user?.login === username);
    const userComments = comments.filter(c => c.user?.login === username);
    const userIssueComments = issueComments.filter(c => c.user?.login === username);
    
    res.json({
      pr: `${repoPath}#${number}`,
      username,
      reviews: {
        total: reviews.length,
        userReviews: userReviews.map(r => ({
          id: r.id,
          state: r.state,
          body: r.body?.substring(0, 100),
          submittedAt: r.submitted_at,
          user: r.user?.login
        })),
        all: reviews.map(r => ({
          id: r.id,
          state: r.state,
          user: r.user?.login,
          submittedAt: r.submitted_at
        }))
      },
      comments: {
        reviewComments: userComments.length,
        issueComments: userIssueComments.length,
        total: userComments.length + userIssueComments.length
      },
      summary: {
        hasReview: userReviews.length > 0,
        reviewStates: userReviews.map(r => r.state),
        hasComments: userComments.length > 0 || userIssueComments.length > 0
      }
    });
  } catch (error) {
    res.status(500).json({ 
      error: error.message, 
      stack: error.stack
    });
  }
});

// Get GitHub stats
router.get('/github', createSimpleEndpoint({
  fetchFn: (dateRange) => githubService.getStats(dateRange)
}));

// Get GitLab stats
router.get('/gitlab', createSimpleEndpoint({
  fetchFn: (dateRange) => gitlabService.getStats(dateRange)
}));

// Get Git stats (GitHub + GitLab) with mock support and smart caching
router.get('/git', async (req, res) => {
  if (req.query.mock === 'true') {
    const mockStats = generateMockStatsData();
    return res.json({
      github: mockStats.github,
      gitlab: mockStats.gitlab,
      reviewStats: mockStats.reviewStats || {
        github: { totalComments: 142, prsReviewed: 45, avgCommentsPerPR: 3.2, avgReviewsPerMonth: 5.6, byRepo: [] },
        gitlab: { totalComments: 89, mrsReviewed: 32, avgCommentsPerMR: 2.8, avgReviewsPerMonth: 4.0, byRepo: [] }
      },
      timestamp: new Date().toISOString()
    });
  }
  
  try {
    const dateRange = parseDateRange(req.query);
    const rangeKey = JSON.stringify(dateRange);
    
    const ownCacheKey = `stats-git:${rangeKey}`;
    const cached = cache.get(ownCacheKey);
    if (cached && cached.reviewStats) {
      setCacheHeaders(res, true);
      return res.json(cached);
    }
    
    const combinedStats = cache.get(`stats:${rangeKey}`);
    if (combinedStats && combinedStats.reviewStats) {
      setCacheHeaders(res, true);
      return res.json({
        github: combinedStats.github,
        gitlab: combinedStats.gitlab,
        reviewStats: combinedStats.reviewStats,
        timestamp: combinedStats.timestamp
      });
    }
    const [githubStats, gitlabStats, githubReviews, gitlabReviews] = await Promise.allSettled([
      githubService.getStats(dateRange),
      gitlabService.getStats(dateRange),
      githubService.getReviewComments(dateRange),
      gitlabService.getReviewComments(dateRange)
    ]);
    
    const result = {
      github: githubStats.status === 'fulfilled' ? githubStats.value : { error: githubStats.reason?.message },
      gitlab: gitlabStats.status === 'fulfilled' ? gitlabStats.value : { error: gitlabStats.reason?.message },
      reviewStats: {
        github: githubReviews.status === 'fulfilled' ? githubReviews.value : { totalComments: 0, prsReviewed: 0, avgCommentsPerPR: 0, avgReviewsPerMonth: 0, byRepo: [] },
        gitlab: gitlabReviews.status === 'fulfilled' ? gitlabReviews.value : { totalComments: 0, mrsReviewed: 0, avgCommentsPerMR: 0, avgReviewsPerMonth: 0, byRepo: [] }
      },
      timestamp: new Date().toISOString()
    };
    
    cache.set(ownCacheKey, result, 300);
    setCacheHeaders(res, false);
    res.json(result);
  } catch (error) {
    console.error('Error fetching git stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Jira stats (with mock support and smart caching)
router.get('/jira', async (req, res) => {
  if (req.query.mock === 'true') {
    return res.json(generateMockStatsData().jira);
  }
  
  try {
    const dateRange = parseDateRange(req.query);
    const rangeKey = JSON.stringify(dateRange);
    
    const combinedStats = cache.get(`stats:${rangeKey}`);
    if (combinedStats && combinedStats.jira) {
      setCacheHeaders(res, true);
      return res.json(combinedStats.jira);
    }
    
    const ownCacheKey = `stats-jira:${rangeKey}`;
    const cached = cache.get(ownCacheKey);
    if (cached) {
      setCacheHeaders(res, true);
      return res.json(cached);
    }
    
    const result = await jiraService.getStats(dateRange);
    
    cache.set(ownCacheKey, result, 300);
    setCacheHeaders(res, false);
    res.json(result);
  } catch (error) {
    console.error('Error fetching jira stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get CTOI participation stats
router.get('/ctoi', async (req, res) => {
  try {
    const dateRange = parseDateRange(req.query);
    const cacheKey = `ctoi-stats:${JSON.stringify(dateRange)}`;
    
    const cached = cache.get(cacheKey);
    if (cached) {
      setCacheHeaders(res, true);
      return res.json(cached);
    }
    
    const result = await jiraService.getCTOIStats(dateRange);
    
    cache.set(cacheKey, result, 300);
    setCacheHeaders(res, false);
    res.json(result);
  } catch (error) {
    console.error('Error fetching CTOI stats:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Fetch all stats for a single user (GitHub, GitLab, Jira)
 * Uses operator tokens to query other users' stats
 */
async function fetchUserStats(user, dateRange) {
  const userId = user.id || user.github?.username || user.gitlab?.username || user.jira?.email || 'unknown';
  const userResult = {
    user: {
      id: userId,
      githubUsername: user.github?.username,
      gitlabUsername: user.gitlab?.username,
      jiraEmail: user.jira?.email,
      level: user.level || null
    },
    github: null,
    gitlab: null,
    jira: null,
    errors: {}
  };
  
  // Fetch all services in parallel (including review stats)
  const [githubStats, gitlabStats, jiraStats, githubReviews, gitlabReviews] = await Promise.allSettled([
    user.github?.username ? githubService.getStats(dateRange, {
      username: user.github.username,
      token: user.github.token || process.env.GITHUB_TOKEN,
      baseURL: user.github.baseURL || process.env.GITHUB_BASE_URL || 'https://github.com'
    }) : Promise.resolve(null),
    user.gitlab?.username ? gitlabService.getStats(dateRange, {
      username: user.gitlab.username,
      token: user.gitlab.token || process.env.GITLAB_TOKEN,
      baseURL: user.gitlab.baseURL || process.env.GITLAB_BASE_URL || 'https://gitlab.com'
    }) : Promise.resolve(null),
    user.jira?.email ? jiraService.getStats(dateRange, {
      email: user.jira.email,
      pat: user.jira.pat || process.env.JIRA_PAT,
      baseURL: user.jira.baseURL || process.env.JIRA_BASE_URL
    }) : Promise.resolve(null),
    user.github?.username ? githubService.getReviewComments(dateRange, {
      username: user.github.username,
      token: user.github.token || process.env.GITHUB_TOKEN,
      baseURL: user.github.baseURL || process.env.GITHUB_BASE_URL || 'https://github.com'
    }) : Promise.resolve(null),
    user.gitlab?.username ? gitlabService.getReviewComments(dateRange, {
      username: user.gitlab.username,
      token: user.gitlab.token || process.env.GITLAB_TOKEN,
      baseURL: user.gitlab.baseURL || process.env.GITLAB_BASE_URL || 'https://gitlab.com'
    }) : Promise.resolve(null)
  ]);
  
  // Process results
  if (githubStats.status === 'fulfilled' && githubStats.value) {
    userResult.github = githubStats.value;
  } else if (githubStats.status === 'rejected') {
    console.error(`  ❌ GitHub stats failed for ${userId}:`, githubStats.reason?.message);
    userResult.errors.github = githubStats.reason?.message;
  }
  
  if (gitlabStats.status === 'fulfilled' && gitlabStats.value) {
    userResult.gitlab = gitlabStats.value;
  } else if (gitlabStats.status === 'rejected') {
    console.error(`  ❌ GitLab stats failed for ${userId}:`, gitlabStats.reason?.message);
    userResult.errors.gitlab = gitlabStats.reason?.message;
  }
  
  if (jiraStats.status === 'fulfilled' && jiraStats.value) {
    userResult.jira = jiraStats.value;
  } else if (jiraStats.status === 'rejected') {
    console.error(`  ❌ Jira stats failed for ${userId}:`, jiraStats.reason?.message);
    userResult.errors.jira = jiraStats.reason?.message;
  }
  
  // Process review stats
  const reviewStats = {};
  if (githubReviews.status === 'fulfilled' && githubReviews.value) {
    reviewStats.github = githubReviews.value;
  }
  if (gitlabReviews.status === 'fulfilled' && gitlabReviews.value) {
    reviewStats.gitlab = gitlabReviews.value;
  }
  if (Object.keys(reviewStats).length > 0) {
    userResult.reviewStats = reviewStats;
  }
  
  return userResult;
}

/**
 * Fetch leaderboard stats for all users
 * @param {Object} dateRange - Date range object
 * @param {boolean} skipCache - If true, skip cache check and always fetch fresh data
 * @returns {Promise<Array>} Leaderboard array
 */
async function fetchLeaderboard(dateRange, skipCache = false) {
  const rangeKey = JSON.stringify(dateRange);
  
  // Load users from engineering-metrics or config file
  const { getUsers, normalizeEngineeringMetricsUser } = require('../utils/userHelpers');
  let users = await getUsers();
  
  if (!users || users.length === 0) {
    return [];
  }
  
  // Normalize users from engineering-metrics format if needed
  const processedUsers = users.map(user => normalizeEngineeringMetricsUser(user));
  
  // Identify the default user (the one using environment variables)
  // This is the user whose stats are already being fetched for other pages
  const defaultGitHubUsername = process.env.GITHUB_USERNAME?.toUpperCase();
  const defaultGitLabUsername = process.env.GITLAB_USERNAME;
  const defaultJiraEmail = process.env.JIRA_EMAIL;
  
  // Try to get default JIRA email from current user if not set
  let resolvedDefaultJiraEmail = defaultJiraEmail;
  if (!resolvedDefaultJiraEmail) {
    try {
      const { getCurrentUser } = require('../services/jira/api');
      const currentUser = await getCurrentUser();
      resolvedDefaultJiraEmail = currentUser?.emailAddress;
    } catch (e) {
      // Silently fail - we'll just check email matches
    }
  }
  
  // Helper to check if a user is the default user
  const isDefaultUser = (user) => {
    const githubMatch = defaultGitHubUsername && user.github?.username?.toUpperCase() === defaultGitHubUsername;
    const gitlabMatch = defaultGitLabUsername && user.gitlab?.username === defaultGitLabUsername;
    const jiraMatch = resolvedDefaultJiraEmail && user.jira?.email?.toLowerCase() === resolvedDefaultJiraEmail?.toLowerCase();
    
    // If any service matches and user doesn't have custom tokens, it's the default user
    return (githubMatch || gitlabMatch || jiraMatch) && 
           !user.github?.token && 
           !user.gitlab?.token && 
           !user.jira?.pat;
  };
  
  const cacheKey = `leaderboard:${users.map(u => u.id || u.github?.username || u.gitlab?.username || u.jira?.email || 'unknown').join(',')}:${rangeKey}`;
  
  if (!skipCache) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }
  
  const startTime = Date.now();
  
  // Get cached stats for default user (already fetched for other pages)
  const defaultUserCachedStats = cache.get(`stats:${rangeKey}`);
  const defaultUserCachedGitStats = cache.get(`stats-git:${rangeKey}`);
  const defaultUserCachedJiraStats = cache.get(`stats-jira:${rangeKey}`);
  
  // Process users in batches to avoid overwhelming APIs and improve perceived performance
  // Each batch processes in parallel, but batches run sequentially with delays
  const BATCH_SIZE = 5; // Reduced from 10 to reduce API load
  const leaderboard = [];
  let rateLimited = false;
  
  for (let i = 0; i < processedUsers.length; i += BATCH_SIZE) {
    // Add delay between batches to avoid rate limiting (except for first batch)
    if (i > 0 && !rateLimited) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay between batches
    }
    
    const batch = processedUsers.slice(i, i + BATCH_SIZE);
    
    // If we're rate limited, skip remaining batches and use cached data if available
    if (rateLimited) {
      console.warn('⚠️ Rate limited detected, skipping remaining batches');
      break;
    }
    
    // Fetch stats for batch in parallel with timeout
    const batchPromises = batch.map((user, userIndex) => {
      // Check if this is the default user - if so, use cached stats instead
      if (isDefaultUser(user) && defaultUserCachedStats) {
        const userId = user.id || user.github?.username || user.gitlab?.username || user.jira?.email || 'unknown';
        return Promise.resolve({
          user: {
            id: userId,
            githubUsername: user.github?.username,
            gitlabUsername: user.gitlab?.username,
            jiraEmail: user.jira?.email,
            level: user.level || null
          },
          github: defaultUserCachedStats.github,
          gitlab: defaultUserCachedStats.gitlab,
          jira: defaultUserCachedStats.jira || defaultUserCachedJiraStats,
          reviewStats: defaultUserCachedGitStats?.reviewStats || null,
          errors: {}
        });
      }
      
      // Add small delay between users within batch to spread out requests
      const delay = userIndex * 100; // 100ms delay between users
      return new Promise(resolve => setTimeout(resolve, delay))
        .then(() => Promise.race([
          fetchUserStats(user, dateRange),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Request timeout')), 30000) // 30s timeout per user
          )
        ]))
        .catch(error => {
          const userId = user.id || user.github?.username || user.gitlab?.username || user.jira?.email || 'unknown';
          
          // Check if this is a rate limit error
          if (error.response?.status === 429 || error.message?.includes('429')) {
            rateLimited = true;
            console.warn(`⚠️ Rate limited (429) detected for ${userId}, will skip remaining batches`);
          }
          
          return {
            user: {
              id: userId,
              githubUsername: user.github?.username,
              gitlabUsername: user.gitlab?.username,
              jiraEmail: user.jira?.email,
              level: user.level || null
            },
            github: null,
            gitlab: null,
            jira: null,
            errors: { general: error.message || 'Request timeout' }
          };
        });
    });
    
    const batchResults = await Promise.allSettled(batchPromises);
    batchResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        leaderboard.push(result.value);
      } else {
        const user = batch[index];
        const userId = user.id || user.github?.username || user.gitlab?.username || user.jira?.email || 'unknown';
        leaderboard.push({
          user: {
            id: userId,
            githubUsername: user.github?.username,
            gitlabUsername: user.gitlab?.username,
            jiraEmail: user.jira?.email,
            level: user.level || null
          },
          github: null,
          gitlab: null,
          jira: null,
          errors: { general: result.reason?.message || 'Unknown error' }
        });
      }
    });
    
    // If rate limited, break out of loop
    if (rateLimited) {
      break;
    }
  }
  
  cache.set(cacheKey, leaderboard, 300);
  return leaderboard;
}

/**
 * Calculate benchmarks from leaderboard data
 * FTE = average across all users (all levels)
 * P1, P2, P3, P4 = average for users at that specific level (excludes contractors)
 */
function calculateBenchmarks(leaderboard) {
  const CONTRACTOR_LEVEL = 'contractor';
  
  const emptyMetrics = {
    created: null,
    reviews: null,
    comments: null,
    commentsPerMonth: null,
    velocity: null,
    storyPoints: null,
    resolved: null,
    avgResolutionTime: null,
    ctoiFixed: null,
    ctoiParticipated: null
  };
  
  if (!leaderboard || leaderboard.length === 0) {
    return {
      fte: { ...emptyMetrics },
      p1: { ...emptyMetrics },
      p2: { ...emptyMetrics },
      p3: { ...emptyMetrics },
      p4: { ...emptyMetrics }
    };
  }

  // Helper to extract metrics from an entry
  const extractMetrics = (entry) => {
    const github = entry.github || {};
    const gitlab = entry.gitlab || {};
    const jira = entry.jira || {};
    const reviewStats = entry.reviewStats || {};
    
    // Git Created (PRs/MRs)
    const githubCreated = github.created > 0 ? github.created : (github.total ?? 0);
    const gitlabCreated = gitlab.created ?? gitlab.total ?? 0;
    const created = githubCreated + gitlabCreated;
    
    // Git Reviews
    const githubReviews = reviewStats.github?.prsReviewed || github.reviews || 0;
    const gitlabReviews = reviewStats.gitlab?.mrsReviewed || 0;
    const reviews = githubReviews + gitlabReviews;
    
    // Git Comments
    const githubComments = reviewStats.github?.totalComments || 0;
    const gitlabComments = reviewStats.gitlab?.totalComments || 0;
    const comments = githubComments + gitlabComments;
    
    // Comments per month - calculate based on monthly data if available
    const githubPRs = github.monthlyPRs || [];
    const gitlabMRs = gitlab.monthlyMRs || [];
    const monthsWithData = new Set([...githubPRs, ...gitlabMRs].map(item => item.month)).size;
    const commentsPerMonth = monthsWithData > 0 ? comments / monthsWithData : 0;
    
    // Jira metrics
    const velocity = jira.velocity?.combinedAverageVelocity || jira.velocity?.averageVelocity || 0;
    const storyPoints = jira.totalStoryPoints || 0;
    const resolved = jira.resolved || 0;
    const avgResolutionTime = jira.avgResolutionTime || 0;
    const ctoiFixed = jira.ctoi?.fixed || 0;
    const ctoiParticipated = jira.ctoi?.participated || 0;
    
    return {
      created,
      reviews,
      comments,
      commentsPerMonth,
      velocity,
      storyPoints,
      resolved,
      avgResolutionTime,
      ctoiFixed,
      ctoiParticipated
    };
  };

  // Helper to calculate averages from an array of metric objects
  const calculateAverages = (entries) => {
    if (entries.length === 0) return { ...emptyMetrics };
    
    const sums = {
      created: 0,
      reviews: 0,
      comments: 0,
      commentsPerMonth: 0,
      velocity: 0,
      storyPoints: 0,
      resolved: 0,
      avgResolutionTime: 0,
      ctoiFixed: 0,
      ctoiParticipated: 0
    };
    
    const counts = {
      created: 0,
      reviews: 0,
      comments: 0,
      commentsPerMonth: 0,
      velocity: 0,
      storyPoints: 0,
      resolved: 0,
      avgResolutionTime: 0,
      ctoiFixed: 0,
      ctoiParticipated: 0
    };
    
    entries.forEach(entry => {
      const metrics = extractMetrics(entry);
      
      // Only count non-zero values for averages
      if (metrics.created > 0) { sums.created += metrics.created; counts.created++; }
      if (metrics.reviews > 0) { sums.reviews += metrics.reviews; counts.reviews++; }
      if (metrics.comments > 0) { sums.comments += metrics.comments; counts.comments++; }
      if (metrics.commentsPerMonth > 0) { sums.commentsPerMonth += metrics.commentsPerMonth; counts.commentsPerMonth++; }
      if (metrics.velocity > 0) { sums.velocity += metrics.velocity; counts.velocity++; }
      if (metrics.storyPoints > 0) { sums.storyPoints += metrics.storyPoints; counts.storyPoints++; }
      if (metrics.resolved > 0) { sums.resolved += metrics.resolved; counts.resolved++; }
      if (metrics.avgResolutionTime > 0) { sums.avgResolutionTime += metrics.avgResolutionTime; counts.avgResolutionTime++; }
      if (metrics.ctoiFixed > 0) { sums.ctoiFixed += metrics.ctoiFixed; counts.ctoiFixed++; }
      if (metrics.ctoiParticipated > 0) { sums.ctoiParticipated += metrics.ctoiParticipated; counts.ctoiParticipated++; }
    });
    
    const avg = (sum, count) => count > 0 ? parseFloat((sum / count).toFixed(1)) : null;
    
    return {
      created: avg(sums.created, counts.created),
      reviews: avg(sums.reviews, counts.reviews),
      comments: avg(sums.comments, counts.comments),
      commentsPerMonth: avg(sums.commentsPerMonth, counts.commentsPerMonth),
      velocity: avg(sums.velocity, counts.velocity),
      storyPoints: avg(sums.storyPoints, counts.storyPoints),
      resolved: avg(sums.resolved, counts.resolved),
      avgResolutionTime: avg(sums.avgResolutionTime, counts.avgResolutionTime),
      ctoiFixed: avg(sums.ctoiFixed, counts.ctoiFixed),
      ctoiParticipated: avg(sums.ctoiParticipated, counts.ctoiParticipated)
    };
  };

  // Calculate FTE averages (all users including contractors)
  const fteAverages = calculateAverages(leaderboard);

  // Group users by level (excluding contractors for level-specific averages)
  const usersByLevel = { p1: [], p2: [], p3: [], p4: [] };
  
  leaderboard.forEach(entry => {
    const level = entry.user?.level?.toLowerCase();
    // Skip contractors for level-specific averages
    if (level && level !== CONTRACTOR_LEVEL && usersByLevel[level]) {
      usersByLevel[level].push(entry);
    }
  });

  // Calculate averages for each level
  const benchmarks = {
    fte: fteAverages,
    p1: calculateAverages(usersByLevel.p1),
    p2: calculateAverages(usersByLevel.p2),
    p3: calculateAverages(usersByLevel.p3),
    p4: calculateAverages(usersByLevel.p4)
  };

  return benchmarks;
}

// Get leaderboard stats for all users
router.get('/leaderboard', async (req, res) => {
  try {
    const dateRange = parseDateRange(req.query);
    const rangeKey = JSON.stringify(dateRange);
    
    // Load users to build cache key
    const { getUsers } = require('../utils/userHelpers');
    const users = await getUsers();
    const cacheKey = `leaderboard:${users.map(u => u.id || u.github?.username || u.gitlab?.username || u.jira?.email || 'unknown').join(',')}:${rangeKey}`;
    const cached = cache.get(cacheKey);
    
    const leaderboard = await fetchLeaderboard(dateRange);
    
    setCacheHeaders(res, !!cached);
    res.json(leaderboard);
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard stats' });
  }
});

// Get benchmarks (FTE and per-level averages)
router.get('/benchmarks', async (req, res) => {
  try {
    const dateRange = parseDateRange(req.query);
    const rangeKey = JSON.stringify(dateRange);
    const cacheKey = `benchmarks:${rangeKey}`;
    
    // Check cache
    const cached = cache.get(cacheKey);
    if (cached) {
      setCacheHeaders(res, true);
      return res.json(cached);
    }
    
    // Fetch leaderboard to calculate benchmarks (use cache if available to avoid duplicate fetches)
    const leaderboard = await fetchLeaderboard(dateRange, false); // Use cache if available
    const benchmarks = calculateBenchmarks(leaderboard);
    
    // Cache for 5 minutes
    cache.set(cacheKey, benchmarks, 300);
    
    setCacheHeaders(res, false);
    res.json(benchmarks);
  } catch (error) {
    console.error('Error calculating benchmarks:', error);
    res.status(500).json({ error: 'Failed to calculate benchmarks' });
  }
});

module.exports = router;
module.exports.fetchLeaderboard = fetchLeaderboard;

