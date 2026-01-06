/**
 * JIRA CTOI - CTOI participation tracking (Fixed vs Participated)
 */

const { jiraApi, getCurrentUser } = require('./api');
const { getIssuePriority, calculateCycleTimeByPriority } = require('./cycleTime');

/**
 * Get CTOI participation stats (Fixed vs Participated by priority)
 * @param {Object|null} dateRange - Optional date range { start, end }
 * @returns {Promise<Object>} CTOI stats
 */
async function getCTOIStats(dateRange = null) {
  const cache = require('../../utils/cache');
  const cacheKey = `jira-ctoi:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ CTOI stats served from cache');
    return cached;
  }

  console.log('📋 Fetching CTOI participation stats...');
  const startTime = Date.now();

  // Get current user info
  const userCacheKey = 'jira-user';
  let cachedUser = cache.get(userCacheKey);
  let userEmail = null;

  if (cachedUser) {
    userEmail = cachedUser.emailAddress;
  } else {
    try {
      const user = await getCurrentUser();
      userEmail = user.emailAddress;
      cache.set(userCacheKey, { accountId: user.accountId, emailAddress: userEmail }, 600);
    } catch (error) {
      console.error('Failed to get current user for CTOI:', error.message);
      return { fixed: 0, participated: 0, total: 0, byPriority: {} };
    }
  }

  // Build JQL for CTOI tickets
  let jql = `project = CTOI AND status changed to Closed`;
  
  if (dateRange?.start && dateRange?.end) {
    jql += ` DURING ("${dateRange.start}", "${dateRange.end}")`;
  } else if (dateRange?.start) {
    jql += ` AFTER "${dateRange.start}"`;
  }
  
  jql += ` ORDER BY updated DESC`;

  const issues = [];
  let startAt = 0;
  const maxResults = 100;
  let hasMore = true;

  while (hasMore) {
    try {
      const response = await jiraApi.post('/rest/api/2/search', {
        jql: jql,
        startAt: startAt,
        maxResults: maxResults,
        fields: ['key', 'summary', 'status', 'priority', 'assignee', 'resolutiondate', 'created', 'customfield_10000']
      });

      if (response.data.issues.length === 0) {
        hasMore = false;
      } else {
        issues.push(...response.data.issues);
        startAt += maxResults;
        
        if (response.data.issues.length < maxResults || issues.length >= response.data.total) {
          hasMore = false;
        }
      }
    } catch (error) {
      console.error('CTOI fetch error:', error.message);
      hasMore = false;
    }
  }

  // Calculate fixed vs participated
  let fixed = 0;
  let participated = 0;
  const byPriority = {
    P1: { fixed: 0, participated: 0 },
    P2: { fixed: 0, participated: 0 },
    P3: { fixed: 0, participated: 0 },
    P4: { fixed: 0, participated: 0 }
  };

  for (const issue of issues) {
    const assigneeEmail = issue.fields?.assignee?.emailAddress || '';
    const priority = getIssuePriority(issue);
    const isAssignee = assigneeEmail.toLowerCase() === userEmail?.toLowerCase();

    if (isAssignee) {
      fixed++;
      if (byPriority[priority]) {
        byPriority[priority].fixed++;
      }
    } else {
      // Assume if the ticket came back in the search, user participated
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
  console.log(`  ✓ CTOI: ${fixed} fixed, ${participated} participated (${Date.now() - startTime}ms)`);

  return result;
}

module.exports = {
  getCTOIStats
};
