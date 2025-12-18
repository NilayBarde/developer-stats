const axios = require('axios');

const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
const JIRA_BASE_URL = process.env.JIRA_BASE_URL;

if (!JIRA_EMAIL || !JIRA_API_TOKEN || !JIRA_BASE_URL) {
  console.warn('Jira credentials not configured. Jira stats will not be available.');
}

// Ensure base URL doesn't have trailing slash for proper API path construction
const normalizedBaseURL = JIRA_BASE_URL ? JIRA_BASE_URL.replace(/\/$/, '') : '';

const jiraApi = axios.create({
  baseURL: normalizedBaseURL,
  auth: {
    username: JIRA_EMAIL,
    password: JIRA_API_TOKEN
  },
  headers: {
    'Accept': 'application/json'
  },
  timeout: 30000
});

async function getCurrentUser() {
  try {
    const response = await jiraApi.get('/rest/api/3/myself');
    return response.data;
  } catch (error) {
    if (error.response?.status === 401) {
      console.error('❌ Jira authentication failed when fetching user (401 Unauthorized)');
      console.error('   Please check your JIRA_EMAIL, JIRA_API_TOKEN, and JIRA_BASE_URL');
    } else {
      console.error('Error fetching Jira user:', error.message);
    }
    throw error;
  }
}

async function getAllIssues() {
  const issues = [];
  let startAt = 0;
  const maxResults = 100;
  let hasMore = true;
  
  // Get current user info first to use their accountId or email
  let userAccountId = null;
  let userEmail = JIRA_EMAIL;
  try {
    const userResponse = await jiraApi.get('/rest/api/3/myself');
    userAccountId = userResponse.data.accountId;
    userEmail = userResponse.data.emailAddress || JIRA_EMAIL;
    console.log(`✓ Authenticated as: ${userResponse.data.displayName} (${userEmail})`);
  } catch (error) {
    if (error.response?.status === 403) {
      console.warn('⚠️  Cannot fetch user info - API token may have restricted permissions');
      console.warn('   Will try alternative JQL queries, but they may also fail with 403');
    } else {
      console.warn('Could not fetch user info, will try alternative JQL queries');
    }
  }

  // Try different JQL queries - API tokens may restrict currentUser() even if web UI allows it
  const jqlQueries = [
    `assignee = currentUser() ORDER BY created DESC`, // Try currentUser() first
    `assignee = "${userEmail}" ORDER BY created DESC`, // Fallback to email
    userAccountId ? `assignee = ${userAccountId} ORDER BY created DESC` : null // Try accountId if available
  ].filter(Boolean);

  let jqlIndex = 0;
  let lastError = null;

  while (hasMore && jqlIndex < jqlQueries.length) {
    try {
      const jql = jqlQueries[jqlIndex];
      if (jqlIndex > 0) {
        console.log(`   Trying alternative JQL query: ${jql}`);
      }
      
      const response = await jiraApi.get('/rest/api/3/search', {
        params: {
          jql: jql,
          startAt: startAt,
          maxResults: maxResults,
          fields: 'summary,status,created,resolutiondate,issuetype,timespent,timeoriginalestimate,storyPoints'
        }
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
      // Success - reset error tracking
      lastError = null;
    } catch (error) {
      lastError = error;
      
      // If 403 and we have more JQL queries to try, try the next one
      if (error.response?.status === 403 && jqlIndex < jqlQueries.length - 1) {
        console.log(`   JQL query "${jqlQueries[jqlIndex]}" failed with 403, trying alternative...`);
        jqlIndex++;
        startAt = 0; // Reset pagination for new query
        continue;
      }
      if (error.response?.status === 401) {
        console.error('❌ Jira authentication failed (401 Unauthorized)');
        console.error('   Please check:');
        console.error('   1. Your JIRA_API_TOKEN is correct and not expired');
        console.error('   2. JIRA_EMAIL matches your Jira account email exactly');
        console.error(`   3. JIRA_BASE_URL is correct (currently: ${normalizedBaseURL || 'not set'})`);
        console.error('      For Disney: https://jira.disney.com');
        console.error('      For Atlassian Cloud: https://your-domain.atlassian.net');
        if (error.response?.data?.errorMessages) {
          console.error(`   Jira says: ${error.response.data.errorMessages.join(', ')}`);
        }
      } else if (lastError?.response?.status === 403) {
        console.error('❌ Jira permission denied (403 Forbidden)');
        console.error('   Tried multiple JQL query formats, all returned 403.');
        console.error('   Note: API tokens may have different JQL restrictions than web UI.');
        console.error('   Even though "assignee = currentUser()" works in your filters,');
        console.error('   API tokens may be restricted from using it.');
        console.error('   Solutions:');
        console.error('   1. Contact your Jira admin to enable API token JQL access');
        console.error('   2. Ask if there\'s a specific permission needed for API queries');
        console.error('   3. Verify your account can view issues in the web UI');
        if (lastError.response?.data?.errorMessages) {
          console.error(`   Jira says: ${lastError.response.data.errorMessages.join(', ')}`);
        }
        if (lastError.response?.data?.warningMessages) {
          console.error(`   Warnings: ${lastError.response.data.warningMessages.join(', ')}`);
        }
      } else if (error.response?.status === 403) {
        // Fallback error message
        console.error('❌ Jira permission denied (403 Forbidden)');
      } else {
        console.error('Error fetching Jira issues:', error.message);
        if (error.response?.status) {
          console.error(`   Status code: ${error.response.status}`);
        }
      }
      hasMore = false;
    }
  }

  return issues;
}

function calculateVelocity(issues) {
  const now = new Date();
  const sprints = {};
  
  // Group issues by sprint (approximate by 2-week periods)
  issues.forEach(issue => {
    if (!issue.fields.resolutiondate) return; // Only count resolved issues
    
    const resolvedDate = new Date(issue.fields.resolutiondate);
    const sprintKey = getSprintKey(resolvedDate);
    
    if (!sprints[sprintKey]) {
      sprints[sprintKey] = {
        startDate: getSprintStart(resolvedDate),
        endDate: getSprintEnd(resolvedDate),
        points: 0,
        issues: 0,
        timeSpent: 0
      };
    }
    
    // Try to get story points
    const storyPoints = issue.fields.customfield_10016 || 
                       issue.fields.storyPoints || 
                       (issue.fields.timeoriginalestimate ? issue.fields.timeoriginalestimate / 3600 / 8 : 0); // Convert to story points estimate
    
    sprints[sprintKey].points += storyPoints;
    sprints[sprintKey].issues += 1;
    sprints[sprintKey].timeSpent += (issue.fields.timespent || 0) / 3600; // Convert to hours
  });

  const sprintArray = Object.values(sprints).sort((a, b) => b.startDate - a.startDate);
  
  // Calculate average velocity
  const velocities = sprintArray.map(sprint => sprint.points);
  const avgVelocity = velocities.length > 0 
    ? velocities.reduce((a, b) => a + b, 0) / velocities.length 
    : 0;

  return {
    sprints: sprintArray.slice(0, 10), // Last 10 sprints
    averageVelocity: Math.round(avgVelocity * 10) / 10,
    totalSprints: sprintArray.length
  };
}

function getSprintKey(date) {
  // Approximate 2-week sprints starting from a reference date
  const referenceDate = new Date('2024-01-01');
  const daysSinceReference = Math.floor((date - referenceDate) / (1000 * 60 * 60 * 24));
  const sprintNumber = Math.floor(daysSinceReference / 14);
  return `sprint-${sprintNumber}`;
}

function getSprintStart(date) {
  const referenceDate = new Date('2024-01-01');
  const daysSinceReference = Math.floor((date - referenceDate) / (1000 * 60 * 60 * 24));
  const sprintNumber = Math.floor(daysSinceReference / 14);
  const sprintStartDays = sprintNumber * 14;
  return new Date(referenceDate.getTime() + sprintStartDays * 24 * 60 * 60 * 1000);
}

function getSprintEnd(date) {
  const start = getSprintStart(date);
  return new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);
}

function calculateStats(issues) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const allTime = issues.length;
  const last30Days = issues.filter(issue => {
    const created = new Date(issue.fields.created);
    return created >= thirtyDaysAgo;
  }).length;
  
  const last90Days = issues.filter(issue => {
    const created = new Date(issue.fields.created);
    return created >= ninetyDaysAgo;
  }).length;

  const resolved = issues.filter(issue => issue.fields.resolutiondate).length;
  const inProgress = issues.filter(issue => 
    issue.fields.status.name !== 'Done' && 
    issue.fields.status.name !== 'Closed'
  ).length;
  const done = issues.filter(issue => 
    issue.fields.status.name === 'Done' || 
    issue.fields.status.name === 'Closed'
  ).length;

  // Calculate average resolution time
  const resolvedIssues = issues.filter(issue => issue.fields.resolutiondate);
  let avgResolutionTime = 0;
  if (resolvedIssues.length > 0) {
    const resolutionTimes = resolvedIssues.map(issue => {
      const created = new Date(issue.fields.created);
      const resolved = new Date(issue.fields.resolutiondate);
      return (resolved - created) / (1000 * 60 * 60 * 24); // days
    });
    avgResolutionTime = resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length;
  }

  // Group by issue type
  const byType = {};
  issues.forEach(issue => {
    const type = issue.fields.issuetype.name;
    if (!byType[type]) {
      byType[type] = { total: 0, resolved: 0 };
    }
    byType[type].total++;
    if (issue.fields.resolutiondate) {
      byType[type].resolved++;
    }
  });

  const velocity = calculateVelocity(issues);

  return {
    total: allTime,
    last30Days,
    last90Days,
    resolved,
    inProgress,
    done,
    avgResolutionTime: Math.round(avgResolutionTime * 10) / 10,
    byType: byType,
    velocity: velocity,
    issues: issues.slice(0, 50) // Return recent 50 issues
  };
}

function generateMockData() {
  const now = new Date();
  const issues = [];
  
  // Generate issues for the last 12 months
  for (let i = 0; i < 12; i++) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const issuesThisMonth = Math.floor(Math.random() * 10) + 5; // 5-14 issues per month
    
    for (let j = 0; j < issuesThisMonth; j++) {
      const day = Math.floor(Math.random() * 28) + 1;
      const createdDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
      const resolvedDate = Math.random() > 0.3 
        ? new Date(createdDate.getTime() + Math.random() * 14 * 24 * 60 * 60 * 1000) // 0-14 days later
        : null;
      
      const issueTypes = ['Bug', 'Story', 'Task', 'Epic'];
      const issueType = issueTypes[Math.floor(Math.random() * issueTypes.length)];
      const status = resolvedDate ? 'Done' : (Math.random() > 0.5 ? 'In Progress' : 'To Do');
      
      const storyPoints = issueType === 'Story' ? Math.floor(Math.random() * 8) + 1 : 0;
      
      issues.push({
        id: `issue-${i}-${j}`,
        key: `PROJ-${1000 + i * 10 + j}`,
        fields: {
          summary: `${issueType}: ${['Fix authentication bug', 'Implement new feature', 'Update documentation', 'Refactor code', 'Add tests'][Math.floor(Math.random() * 5)]}`,
          status: { name: status },
          created: createdDate.toISOString(),
          resolutiondate: resolvedDate ? resolvedDate.toISOString() : null,
          issuetype: { name: issueType },
          timespent: resolvedDate ? Math.floor(Math.random() * 16 * 3600) : 0, // 0-16 hours
          timeoriginalestimate: storyPoints * 8 * 3600, // Convert story points to hours estimate
          customfield_10016: storyPoints, // Story points field
          storyPoints: storyPoints
        }
      });
    }
  }
  
  return issues;
}

async function getStats() {
  const hasCredentials = JIRA_EMAIL && JIRA_API_TOKEN && JIRA_BASE_URL &&
                         JIRA_EMAIL.trim() !== '' && 
                         JIRA_API_TOKEN.trim() !== '' &&
                         JIRA_BASE_URL.trim() !== '';
  
  if (!hasCredentials) {
    console.log('⚠️  Using mock Jira data - credentials not configured');
    const issues = generateMockData();
    const stats = calculateStats(issues);
    return {
      ...stats,
      source: 'jira',
      email: 'mock@example.com',
      isMock: true
    };
  }

  console.log(`✅ Using real Jira data for: ${JIRA_EMAIL}`);
  try {
    const issues = await getAllIssues();
    const stats = calculateStats(issues);
    
    return {
      ...stats,
      source: 'jira',
      email: JIRA_EMAIL,
      isMock: false
    };
  } catch (error) {
    console.error('❌ Error fetching Jira stats:', error.message);
    console.error('   Falling back to mock data');
    const issues = generateMockData();
    const stats = calculateStats(issues);
    return {
      ...stats,
      source: 'jira',
      email: JIRA_EMAIL,
      isMock: true,
      error: error.message
    };
  }
}

module.exports = {
  getStats
};

