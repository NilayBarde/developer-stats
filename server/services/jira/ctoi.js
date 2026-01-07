/**
 * JIRA CTOI - CTOI participation tracking (Fixed vs Participated)
 */

const { jiraApi, getCurrentUser, createJiraClient } = require('./api');
const { getIssuePriority, calculateCycleTimeByPriority } = require('./cycleTime');

/**
 * Get CTOI participation stats (Fixed vs Participated by priority)
 * @param {Object|null} dateRange - Optional date range { start, end }
 * @param {Object|null} credentials - Optional credentials { email, pat, baseURL }
 * @returns {Promise<Object>} CTOI stats
 */
async function getCTOIStats(dateRange = null, credentials = null) {
  const cache = require('../../utils/cache');
  const userEmail = credentials?.email;
  const cacheKey = `jira-ctoi:${userEmail || 'default'}:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const client = credentials ? createJiraClient(credentials.pat, credentials.baseURL) : jiraApi;

  // When credentials.email is provided, use it directly (don't call getCurrentUser)
  // getCurrentUser() returns the PAT owner, not the user we're querying for
  let resolvedUserEmail = userEmail;
  
  if (credentials && userEmail) {
    // We have an explicit email to query - use it directly
    resolvedUserEmail = userEmail;
    // Try to get from cache if available, but don't call getCurrentUser
    const userCacheKey = `jira-user:${userEmail}`;
    const cachedUser = cache.get(userCacheKey);
    if (cachedUser) {
      resolvedUserEmail = cachedUser.emailAddress || userEmail;
    }
    // Note: We don't call getCurrentUser here because it would return PAT owner's info
  } else {
    // No explicit credentials - get current user (PAT owner)
    const userCacheKey = 'jira-user';
    let cachedUser = cache.get(userCacheKey);
    if (cachedUser) {
      resolvedUserEmail = cachedUser.emailAddress || userEmail;
    } else {
      try {
        const user = await getCurrentUser(credentials);
        resolvedUserEmail = user.emailAddress || userEmail;
        cache.set(userCacheKey, { accountId: user.accountId, emailAddress: resolvedUserEmail }, 600);
      } catch (error) {
        console.error('Failed to get current user for CTOI:', error.message);
        return { fixed: 0, participated: 0, total: 0, byPriority: {} };
      }
    }
  }

  // Build JQL for CTOI tickets - filter by user participation
  // Get tickets where user is assignee OR commented
  // Note: CTOI uses "status changed to Closed" syntax, not date field filtering
  let dateFilter = '';
  if (dateRange && dateRange.start && dateRange.end) {
    dateFilter = ` AND status changed to Closed DURING ("${dateRange.start}", "${dateRange.end}")`;
  } else if (dateRange && dateRange.start) {
    dateFilter = ` AND status changed to Closed AFTER "${dateRange.start}"`;
  } else {
    dateFilter = ` AND status changed to Closed`;
  }
  
  // Query 1: Tickets where user is assignee (fixed)
  let fixedJql = `project = CTOI AND assignee = "${resolvedUserEmail}"${dateFilter} ORDER BY updated DESC`;
  
  // Query 2: Tickets where user participated (but not assignee)
  // Note: Jira JQL doesn't directly support filtering by comment author email
  // We'll try multiple approaches:
  // 1. worklogAuthor - tickets where user logged work
  // 2. comment ~ email - tickets where email appears in comments (not perfect but catches some)
  // If these don't work, we'll fall back to fetching comments separately
  let participatedJql = `project = CTOI AND assignee != "${resolvedUserEmail}" AND (worklogAuthor = "${resolvedUserEmail}" OR comment ~ "${resolvedUserEmail}")${dateFilter} ORDER BY updated DESC`;

  const issues = [];
  const fixedIssues = [];
  const participatedIssues = [];
  
  // Fetch fixed tickets
  let startAt = 0;
  const maxResults = 100;
  let hasMore = true;

  while (hasMore) {
    try {
      const response = await client.post('/rest/api/2/search', {
        jql: fixedJql,
        startAt: startAt,
        maxResults: maxResults,
        fields: ['key', 'summary', 'status', 'priority', 'assignee', 'resolutiondate', 'created', 'customfield_10000']
      });

      if (response.data.issues.length === 0) {
        hasMore = false;
      } else {
        fixedIssues.push(...response.data.issues);
        startAt += maxResults;
        
        if (response.data.issues.length < maxResults || fixedIssues.length >= response.data.total) {
          hasMore = false;
        }
      }
    } catch (error) {
      console.error('CTOI fixed fetch error:', error.message);
      hasMore = false;
    }
  }

  // Fetch participated tickets
  startAt = 0;
  hasMore = true;
  
  while (hasMore) {
    try {
      const response = await client.post('/rest/api/2/search', {
        jql: participatedJql,
        startAt: startAt,
        maxResults: maxResults,
        fields: ['key', 'summary', 'status', 'priority', 'assignee', 'resolutiondate', 'created', 'customfield_10000', 'comment']
      });

      if (response.data.issues.length === 0) {
        hasMore = false;
      } else {
        participatedIssues.push(...response.data.issues);
        startAt += maxResults;
        
        if (response.data.issues.length < maxResults || participatedIssues.length >= response.data.total) {
          hasMore = false;
        }
      }
    } catch (error) {
      // If comment-based query fails, try a simpler approach
      console.warn('CTOI participated fetch error, trying alternative:', error.message);
      // Fallback: get all CTOI tickets and filter by checking comments separately
      // For now, just break and we'll use empty participated list
      hasMore = false;
    }
  }

  // Combine and deduplicate issues
  const allIssueKeys = new Set();
  fixedIssues.forEach(issue => {
    if (!allIssueKeys.has(issue.key)) {
      issues.push(issue);
      allIssueKeys.add(issue.key);
    }
  });
  
  participatedIssues.forEach(issue => {
    if (!allIssueKeys.has(issue.key)) {
      issues.push(issue);
      allIssueKeys.add(issue.key);
    }
  });

  // Calculate fixed vs participated
  let fixed = 0;
  let participated = 0;
  const byPriority = {
    P1: { fixed: 0, participated: 0 },
    P2: { fixed: 0, participated: 0 },
    P3: { fixed: 0, participated: 0 },
    P4: { fixed: 0, participated: 0 }
  };

  const fixedKeys = new Set(fixedIssues.map(i => i.key));
  
  for (const issue of issues) {
    const priority = getIssuePriority(issue);
    const isFixed = fixedKeys.has(issue.key);

    if (isFixed) {
      fixed++;
      if (byPriority[priority]) {
        byPriority[priority].fixed++;
      }
    } else {
      participated++;
      if (byPriority[priority]) {
        byPriority[priority].participated++;
      }
    }
  }

  const result = {
    fixed,
    participated,
    total: fixed + participated,
    byPriority,
    cycleTime: calculateCycleTimeByPriority(issues)
  };

  cache.set(cacheKey, result, 300);

  return result;
}

module.exports = {
  getCTOIStats
};
