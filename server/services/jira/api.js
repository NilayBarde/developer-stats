const axios = require('axios');
const { buildJqlDateFilter, buildJqlQuery } = require('../../utils/jiraHelpers');

const JIRA_PAT = process.env.JIRA_PAT;
const JIRA_BASE_URL = process.env.JIRA_BASE_URL;

if (!JIRA_PAT || !JIRA_BASE_URL) {
  console.warn('Jira credentials not configured. Jira stats will not be available.');
}

// Ensure base URL doesn't have trailing slash
const normalizedBaseURL = JIRA_BASE_URL ? JIRA_BASE_URL.replace(/\/$/, '') : '';

const jiraApi = axios.create({
  baseURL: normalizedBaseURL,
  headers: {
    'Authorization': `Bearer ${JIRA_PAT}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  },
  timeout: 30000
});

/**
 * Create Jira API client with custom credentials
 */
function createJiraClient(pat, baseURL) {
  const normalizedURL = baseURL ? baseURL.replace(/\/$/, '') : '';
  return axios.create({
    baseURL: normalizedURL,
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    timeout: 30000
  });
}

/**
 * Get current Jira user
 * @param {Object|null} credentials - Optional credentials { email, pat, baseURL }
 */
async function getCurrentUser(credentials = null) {
  const client = credentials ? createJiraClient(credentials.pat, credentials.baseURL) : jiraApi;
  
  try {
    const response = await client.get('/rest/api/2/myself');
    return response.data;
  } catch (error) {
    if (error.response?.status === 401) {
      console.error('❌ Jira authentication failed when fetching user (401 Unauthorized)');
      console.error('   Please check your JIRA_PAT and JIRA_BASE_URL');
    } else {
      console.error('Error fetching Jira user:', error.message);
    }
    throw error;
  }
}

/**
 * Get all issues for the current user
 * @param {Object} dateRange - Optional date range filter
 * @param {Object} options - Options object
 * @param {boolean} options.includeAllStatuses - If true, fetch all issues (not just Done/Closed)
 * @param {Object|null} options.credentials - Optional credentials { email, pat, baseURL }
 */
async function getAllIssues(dateRange = null, options = {}) {
  const { includeAllStatuses = false, credentials = null } = options;
  
  const userEmail = credentials?.email;
  const cache = require('../../utils/cache');
  const cacheKey = `jira-raw-issues:${userEmail || 'default'}:${includeAllStatuses ? 'all' : 'resolved'}:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`✓ Raw issues served from cache (${includeAllStatuses ? 'all statuses' : 'resolved only'})`);
    return cached;
  }
  
  const client = credentials ? createJiraClient(credentials.pat, credentials.baseURL) : jiraApi;
  const issues = [];
  let startAt = 0;
  const maxResults = 100;
  let hasMore = true;
  
  // When credentials.email is provided, use it directly (don't call getCurrentUser)
  // getCurrentUser() returns the PAT owner, not the user we're querying for
  let userAccountId = null;
  let resolvedUserEmail = userEmail;
  
  if (credentials && userEmail) {
    // We have an explicit email to query - use it directly
    resolvedUserEmail = userEmail;
    // Try to get accountId from cache if available, but don't call getCurrentUser
    const userCacheKey = `jira-user:${userEmail}`;
    const cachedUser = cache.get(userCacheKey);
    if (cachedUser) {
      userAccountId = cachedUser.accountId;
      // Use cached email if available, otherwise use provided email
      resolvedUserEmail = cachedUser.emailAddress || userEmail;
    }
    // Note: We don't call getCurrentUser here because it would return PAT owner's info
  } else {
    // No explicit credentials - get current user (PAT owner)
    const userCacheKey = 'jira-user';
    let cachedUser = cache.get(userCacheKey);
    if (cachedUser) {
      userAccountId = cachedUser.accountId;
      resolvedUserEmail = cachedUser.emailAddress || userEmail;
    } else {
      try {
        const user = await getCurrentUser(credentials);
        userAccountId = user.accountId;
        resolvedUserEmail = user.emailAddress || userEmail;
        cache.set(userCacheKey, { accountId: userAccountId, emailAddress: resolvedUserEmail }, 600);
      } catch (error) {
        // Silently fail - will try alternative JQL queries
      }
    }
  }

  // Status filter: either all issues or just resolved
  const statusFilter = includeAllStatuses 
    ? '' 
    : `status in (Done, Closed)`;

  // Date range filter for JQL
  // For resolved issues, filter by resolutiondate (matches engineering-metrics)
  // For all-status queries, filter by updated date
  // Note: Velocity calculation filters months afterward, so date filtering here is correct
  const dateField = includeAllStatuses ? 'updated' : 'resolutiondate';
  const dateFilter = buildJqlDateFilter(dateRange, dateField);

  // Build JQL queries - try different assignee formats
  // When credentials are provided (querying for specific user), skip currentUser() 
  // because it will refer to the PAT owner, not the user we're querying for
  const baseQueries = [];
  const orderBy = includeAllStatuses ? 'ORDER BY updated DESC' : 'ORDER BY resolved DESC';
  const filters = [statusFilter, dateFilter].filter(f => f);
  
  if (!credentials) {
    // Only use currentUser() when no explicit credentials (default user)
    baseQueries.push(buildJqlQuery('assignee = currentUser()', filters, orderBy));
  }
  
  // Always try email and accountId when available
  if (resolvedUserEmail) {
    baseQueries.push(buildJqlQuery(`assignee = "${resolvedUserEmail}"`, filters, orderBy));
  }
  if (userAccountId) {
    baseQueries.push(buildJqlQuery(`assignee = ${userAccountId}`, filters, orderBy));
  }
  
  const jqlQueries = baseQueries;

  // Only fetch fields we actually need to reduce payload size
  const requiredFields = [
    'key', 'summary', 'status', 'created', 'updated', 'resolutiondate',
    'issuetype', 'project', 'timespent', 'timeoriginalestimate',
    'assignee', 'reporter', 'priority', 'description',
    'labels', 'components', // For ESPN Web scope checking
    'customfield_10207', // Root Cause field (for CTOI scope checking)
    'customfield_10105', 'customfield_10020', 'customfield_10007', 'customfield_10000', // Sprint fields
    'customfield_10106', 'customfield_21766', 'customfield_10016', 'customfield_10021', // Story point fields
    'customfield_10002', 'customfield_10004', 'customfield_10020',
    'customfield_10101', // Disney Jira epic link field
    'customfield_10011', 'customfield_10014', 'customfield_10015', 'customfield_10008', 'customfield_10009', 'customfield_10010', // Common epic link fields
    'parent', 'epicLink', 'epicName' // Epic fields
  ];

  let jqlIndex = 0;

  while (hasMore && jqlIndex < jqlQueries.length) {
    try {
      const jql = jqlQueries[jqlIndex];
      const response = await client.post('/rest/api/2/search', {
        jql: jql,
        startAt: startAt,
        maxResults: maxResults,
        fields: requiredFields,
        expand: ['names', 'changelog']
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
      // If 403 and we have more JQL queries to try, try the next one
      if (error.response?.status === 403 && jqlIndex < jqlQueries.length - 1) {
        jqlIndex++;
        startAt = 0;
        continue;
      }
      
      if (error.response?.status === 401) {
        console.error('❌ Jira authentication failed (401 Unauthorized). Check JIRA_PAT and JIRA_BASE_URL.');
      } else if (error.response?.status === 403) {
        console.error('❌ Jira permission denied (403 Forbidden). Check API token permissions.');
      } else {
        console.error('Error fetching Jira issues:', error.message);
      }
      hasMore = false;
    }
  }

  // Cache raw issues for 10 minutes
  cache.set(cacheKey, issues, 600);
  return issues;
}

/**
 * Check if JIRA is configured
 * @returns {boolean}
 */
function isConfigured() {
  return !!(JIRA_PAT && JIRA_BASE_URL);
}

module.exports = {
  jiraApi,
  getCurrentUser,
  getAllIssues,
  isConfigured,
  createJiraClient,
  JIRA_PAT,
  JIRA_BASE_URL,
  normalizedBaseURL
};
