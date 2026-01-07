/**
 * JIRA Service - Main entry point
 * Orchestrates all JIRA functionality and exports public API
 */

const { filterByDateRange, calculateMonthlyStats, calculateTimePeriodStats, formatDateRangeForResponse } = require('../../utils/dateHelpers');
const { jiraApi, getCurrentUser, getAllIssues, isConfigured, JIRA_PAT, JIRA_BASE_URL } = require('./api');
const { calculateCycleTimeByPriority, getIssuePriority, getInProgressDate, getQAReadyDate } = require('./cycleTime');
const { getStoryPoints, isInESPNWebScope } = require('./scope');
const { calculateVelocity } = require('./velocity');
const { getCTOIStats } = require('./ctoi');
const { findSprintField, extractSprintInfo, getAllSprints, getBestSprintForIssue, getSprintName, getBoardIdsFromIssues, getBoardName } = require('./sprints');

/**
 * Calculate comprehensive stats from issues
 * @param {Array} issues - Array of JIRA issues  
 * @param {Object|null} dateRange - Optional date range
 * @returns {Promise<Object>} Calculated stats
 */
async function calculateStats(issues, dateRange = null) {
  // Don't filter issues by date - velocity calculation groups by month from resolutiondate
  let filteredIssues = issues;

  // Exclude closed unassigned tickets
  filteredIssues = filteredIssues.filter(issue => {
    const statusName = issue.fields?.status?.name || '';
    const isClosed = ['Done', 'Closed', 'Resolved'].includes(statusName);
    const isUnassigned = !issue.fields?.assignee;
    return !(isClosed && isUnassigned);
  });
  
  // Exclude User Story issue types (containers, not actual work)
  filteredIssues = filteredIssues.filter(issue => 
    issue.fields?.issuetype?.name !== 'User Story'
  );

  // Basic stats
  const timePeriodStats = calculateTimePeriodStats(filteredIssues, 'fields.updated');
  
  const resolved = filteredIssues.filter(issue => issue.fields.resolutiondate).length;
  const inProgress = filteredIssues.filter(issue => 
    issue.fields.status.name !== 'Done' && 
    issue.fields.status.name !== 'Closed'
  ).length;
  const done = filteredIssues.filter(issue => 
    issue.fields.status.name === 'Done' || 
    issue.fields.status.name === 'Closed'
  ).length;

  // Cycle time (created → resolved)
  const cycleTimeByPriority = calculateCycleTimeByPriority(filteredIssues);
  const avgResolutionTime = cycleTimeByPriority.overall || 0;
  const resolutionTimeCount = cycleTimeByPriority.counts.total;

  // Group by issue type
  const byType = {};
  filteredIssues.forEach(issue => {
    const type = issue.fields.issuetype.name;
    if (!byType[type]) {
      byType[type] = { total: 0, resolved: 0 };
    }
    byType[type].total++;
    if (issue.fields.resolutiondate) {
      byType[type].resolved++;
    }
  });

  // Group by project
  const byProject = {};
  filteredIssues.forEach(issue => {
    const projectKey = issue.fields.project.key;
    if (!byProject[projectKey]) {
      byProject[projectKey] = { total: 0, resolved: 0, open: 0 };
    }
    byProject[projectKey].total++;
    if (issue.fields.resolutiondate) {
      byProject[projectKey].resolved++;
    } else {
      byProject[projectKey].open++;
    }
  });

  // Total story points
  const totalStoryPoints = filteredIssues.reduce((sum, issue) => {
    return sum + getStoryPoints(issue);
  }, 0);

  // Velocity
  const velocity = calculateVelocity(filteredIssues, dateRange);

  // Monthly stats
  const monthlyIssues = calculateMonthlyStats(filteredIssues, 'fields.updated', dateRange);

  // Sort by updated descending
  const sortByUpdatedDesc = (a, b) => {
    const dateA = new Date(a.fields?.updated || a.fields?.created || 0);
    const dateB = new Date(b.fields?.updated || b.fields?.created || 0);
    if (isNaN(dateA.getTime())) return 1;
    if (isNaN(dateB.getTime())) return -1;
    return dateB - dateA;
  };

  // Recently updated issues
  const issuesToReturn = filteredIssues
    .filter(issue => issue.fields?.updated || issue.fields?.created)
    .sort(sortByUpdatedDesc)
    .slice(0, 5);

  // Flatten cycleTime structure for frontend compatibility
  const cycleTime = {
    P1: cycleTimeByPriority.byPriority.P1.avg,
    P2: cycleTimeByPriority.byPriority.P2.avg,
    P3: cycleTimeByPriority.byPriority.P3.avg,
    P4: cycleTimeByPriority.byPriority.P4.avg,
    overall: cycleTimeByPriority.overall,
    counts: cycleTimeByPriority.counts
  };

  return {
    total: filteredIssues.length,
    ...timePeriodStats,
    resolved,
    inProgress,
    done,
    totalStoryPoints,
    cycleTime: cycleTime,
    avgResolutionTime: Math.round(avgResolutionTime * 10) / 10,
    avgResolutionTimeCount: resolutionTimeCount,
    byType: byType,
    byProject: byProject,
    velocity: velocity,
    monthlyIssues: monthlyIssues.monthly,
    avgIssuesPerMonth: monthlyIssues.averagePerMonth,
    issues: issuesToReturn,
    dateRange: formatDateRangeForResponse(dateRange)
  };
}

/**
 * Get JIRA stats (main entry point)
 * @param {Object|null} dateRange - Optional date range
 * @param {Object|null} credentials - Optional credentials { email, pat, baseURL }
 * @returns {Promise<Object>} JIRA stats
 */
async function getStats(dateRange = null, credentials = null) {
  const pat = credentials?.pat || JIRA_PAT;
  const baseURL = credentials?.baseURL || JIRA_BASE_URL;
  
  if (!pat || !baseURL) {
    throw new Error('Jira credentials not configured. Please set JIRA_PAT and JIRA_BASE_URL environment variables.');
  }

  const cache = require('../../utils/cache');
  const userEmail = credentials?.email || 'default';
  const cacheKey = `jira-stats:${userEmail}:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ Jira stats served from cache');
    return cached;
  }

  console.log(`📋 Fetching JIRA stats for ${userEmail}...`);
  const startTime = Date.now();

  // Try to reuse enriched issues from getAllIssuesForPage cache if available
  // This only works when no credentials are provided (both use default user)
  let issues = null;
  if (!credentials) {
    const issuesPageCacheKey = `issues-page:${JSON.stringify(dateRange)}`;
    const cachedEnrichedIssues = cache.get(issuesPageCacheKey);
    if (cachedEnrichedIssues) {
      console.log('✓ Reusing enriched issues from Issues page cache');
      issues = cachedEnrichedIssues;
    }
  }

  // Fetch both main stats and CTOI stats in parallel
  // If we didn't reuse cache, fetch issues fresh
  const [fetchedIssues, ctoiStats] = await Promise.all([
    issues ? Promise.resolve(issues) : getAllIssues(dateRange, { includeAllStatuses: true, credentials }),
    getCTOIStats(dateRange, credentials).catch(err => {
      console.warn('⚠️ Failed to fetch CTOI stats:', err.message);
      return null;
    })
  ]);
  
  // Use fetched issues (either from cache or fresh fetch)
  issues = fetchedIssues;
  
  const stats = await calculateStats(issues, dateRange);
  
  // Merge CTOI stats into the response
  if (ctoiStats) {
    stats.ctoi = ctoiStats;
  }

  cache.set(cacheKey, stats, 120); // 2 minutes
  console.log(`  ✓ JIRA stats calculated (${Date.now() - startTime}ms)`);

  return stats;
}

/**
 * Get all issues formatted for the Issues page
 * @param {Object|null} dateRange - Optional date range
 * @returns {Promise<Array>} Array of issues
 */
async function getAllIssuesForPage(dateRange = null) {
  if (!isConfigured()) {
    throw new Error('Jira credentials not configured. Please set JIRA_PAT and JIRA_BASE_URL environment variables.');
  }

  const cache = require('../../utils/cache');
  const cacheKey = `issues-page:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ Issues page served from cache');
    return cached;
  }

  try {
    // Get all issues (not just resolved) for the Issues page
    const allIssues = await getAllIssues(dateRange, { includeAllStatuses: true });
    
    // Enrich issues with sprint name, in progress date, and QA ready date
    const enrichedIssues = allIssues.map(issue => {
      const sprintName = getSprintName(issue);
      const inProgressDate = getInProgressDate(issue);
      const qaReadyDate = getQAReadyDate(issue);
      
      return {
        ...issue,
        _sprintName: sprintName,
        _inProgressDate: inProgressDate ? inProgressDate.toISOString() : null,
        _qaReadyDate: qaReadyDate ? qaReadyDate.toISOString() : null
      };
    });
    
    // Sort by updated date descending
    const sortedIssues = [...enrichedIssues].sort((a, b) => {
      const dateA = new Date(a.fields.updated);
      const dateB = new Date(b.fields.updated);
      return dateB - dateA;
    });

    // Date range filtering is already done at JQL level in getAllIssues()
    // No additional filtering needed here
    
    cache.set(cacheKey, sortedIssues, 120);
    return sortedIssues;
  } catch (error) {
    console.error('Error fetching issues page:', error.message);
    throw error;
  }
}

/**
 * Fetch all issues for a given epic (not just user's issues)
 * @param {string} epicKey - The epic key (e.g., "SEWEB-59921")
 * @returns {Promise<Array>} Array of all issues in the epic
 */
async function getAllIssuesForEpic(epicKey) {
  const requiredFields = [
    'key', 'summary', 'status', 'created', 'updated', 'resolutiondate',
    'issuetype', 'project', 'assignee', 'parent', 'epicLink', 'epicName',
    'customfield_10101', 'customfield_10011', 'customfield_10014', 
    'customfield_10015', 'customfield_10008', 'customfield_10009', 
    'customfield_10010', 'customfield_10007',
    'customfield_10106', 'customfield_21766', 'customfield_10016', 'customfield_10021' // Story point fields
  ];

  // Build JQL query to find all issues linked to this epic
  // Try multiple ways an issue can be linked to an epic using OR
  const epicConditions = [
    `parent = ${epicKey}`,  // Issues with parent = epic
    `"Epic Link" = ${epicKey}`,  // Standard epic link field
    `epicLink = ${epicKey}`,  // Alternative epic link field
    `customfield_10101 = ${epicKey}`,  // Disney Jira epic link field
    `customfield_10011 = ${epicKey}`,  // Common epic link fields
    `customfield_10014 = ${epicKey}`,
    `customfield_10015 = ${epicKey}`,
    `customfield_10008 = ${epicKey}`,
    `customfield_10009 = ${epicKey}`,
    `customfield_10010 = ${epicKey}`,
    `customfield_10007 = ${epicKey}`
  ];

  const jql = `(${epicConditions.join(' OR ')}) AND issuetype != Epic ORDER BY updated DESC`;

  const allIssues = [];
  
  try {
    let startAt = 0;
    const maxResults = 100;
    let hasMore = true;
    
    while (hasMore) {
      const response = await jiraApi.post('/rest/api/2/search', {
        jql: jql,
        startAt: startAt,
        maxResults: maxResults,
        fields: requiredFields
      });

      if (response.data.issues && response.data.issues.length > 0) {
        allIssues.push(...response.data.issues);
        startAt += maxResults;
        
        if (response.data.issues.length < maxResults || allIssues.length >= response.data.total) {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    }
  } catch (error) {
    // Handle rate limiting (429) - return empty array, will use user's issues as fallback
    if (error.response?.status === 429) {
      console.warn(`Rate limited (429) when fetching issues for epic ${epicKey}. Using user's issues only.`);
      return [];
    }
    
    // If the combined query fails (e.g., some fields don't exist), try individual queries
    if (error.response?.status === 400) {
      console.warn(`Combined JQL query failed for epic ${epicKey}, trying individual queries...`);
      
      // Fallback: try queries individually (but skip if we're rate limited)
      for (const condition of epicConditions) {
        try {
          const fallbackJql = `${condition} AND issuetype != Epic ORDER BY updated DESC`;
          let startAt = 0;
          const maxResults = 100;
          let hasMore = true;
          
          while (hasMore) {
            const response = await jiraApi.post('/rest/api/2/search', {
              jql: fallbackJql,
              startAt: startAt,
              maxResults: maxResults,
              fields: requiredFields
            });

            if (response.data.issues && response.data.issues.length > 0) {
              allIssues.push(...response.data.issues);
              startAt += maxResults;
              
              if (response.data.issues.length < maxResults || allIssues.length >= response.data.total) {
                hasMore = false;
              }
            } else {
              hasMore = false;
            }
          }
        } catch (fallbackError) {
          // Stop trying if we hit rate limit
          if (fallbackError.response?.status === 429) {
            console.warn(`Rate limited (429) when fetching issues for epic ${epicKey}. Stopping individual queries.`);
            break;
          }
          // Continue to next condition if this one fails (but not for 400/404)
          if (fallbackError.response?.status !== 400 && fallbackError.response?.status !== 404) {
            console.warn(`Error fetching issues for epic ${epicKey} with condition "${condition}":`, fallbackError.message);
          }
        }
      }
    } else {
      console.warn(`Error fetching issues for epic ${epicKey}:`, error.message);
    }
  }

  // Deduplicate issues by key
  const uniqueIssues = [];
  const seenKeys = new Set();
  for (const issue of allIssues) {
    if (!seenKeys.has(issue.key)) {
      seenKeys.add(issue.key);
      uniqueIssues.push(issue);
    }
  }

  return uniqueIssues;
}

/**
 * Get projects grouped by epic
 * @param {Object|null} dateRange - Optional date range
 * @returns {Promise<Object>} Projects by epic
 */
async function getProjectsByEpic(dateRange = null) {
  if (!isConfigured()) {
    throw new Error('Jira credentials not configured. Please set JIRA_PAT and JIRA_BASE_URL environment variables.');
  }

  const cache = require('../../utils/cache');
  const cacheKey = `projects-by-epic-v3:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ Projects by epic served from cache');
    return cached;
  }

  try {
    let currentUserAccountId = null;
    let currentUserEmail = null;
    try {
      const user = await getCurrentUser();
      currentUserAccountId = user.accountId;
      currentUserEmail = user.emailAddress;
    } catch (error) {
      // Silently fail
    }

    // Include ALL statuses for projects view
    const allIssues = await getAllIssues(dateRange, { includeAllStatuses: true });
    
    // Filter by date range
    let userIssuesInDateRange = allIssues;
    if (dateRange && (dateRange.start || dateRange.end)) {
      userIssuesInDateRange = allIssues.filter(issue => {
        const updated = new Date(issue.fields.updated);
        if (dateRange.start && updated < new Date(dateRange.start)) return false;
        if (dateRange.end && updated > new Date(dateRange.end)) return false;
        return true;
      });
    }
    
    if (userIssuesInDateRange.length === 0) {
      return {
        epics: [],
        issuesWithoutEpic: 0,
        issuesWithoutEpicList: [],
        totalEpics: 0
      };
    }
    
    // Exclude closed unassigned tickets
    let filteredIssues = userIssuesInDateRange.filter(issue => {
      const statusName = issue.fields?.status?.name || '';
      const isClosed = ['Done', 'Closed', 'Resolved'].includes(statusName);
      const isUnassigned = !issue.fields?.assignee;
      return !(isClosed && isUnassigned);
    });
    
    // Extract epic keys from user's issues
    const epicKeysSet = new Set();
    const issuesWithoutEpic = [];
    
    const epicLinkFieldId = null;
    
    function extractEpicKey(issue) {
      if (!issue || !issue.fields) return null;
      
      // Check parent field
      if (issue.fields.parent) {
        const parent = issue.fields.parent;
        let parentKey = null;
        
        if (typeof parent === 'string') {
          parentKey = parent;
        } else if (parent.key) {
          parentKey = parent.key;
        }
        
        if (parentKey && /^[A-Z]+-\d+$/.test(parentKey)) {
          return parentKey;
        }
      }
      
      // Check epicLink field
      if (issue.fields.epicLink) {
        const epicLink = issue.fields.epicLink;
        if (typeof epicLink === 'string' && /^[A-Z]+-\d+$/.test(epicLink)) {
          return epicLink;
        }
        if (epicLink && typeof epicLink === 'object' && epicLink.key) {
          return epicLink.key;
        }
      }
      
      // Check common epic link custom fields
      const epicLinkFields = [
        'customfield_10101',
        'customfield_10011', 'customfield_10014', 'customfield_10015',
        'customfield_10008', 'customfield_10009', 'customfield_10010',
        'customfield_10007'
      ];
      for (const fieldId of epicLinkFields) {
        const value = issue.fields[fieldId];
        if (value) {
          if (typeof value === 'string' && /^[A-Z]+-\d+$/.test(value)) {
            return value;
          }
          if (value && typeof value === 'object' && value.key && /^[A-Z]+-\d+$/.test(value.key)) {
            return value.key;
          }
        }
      }
      
      // Search all fields for epic-like references
      for (const [fieldKey, fieldValue] of Object.entries(issue.fields)) {
        if (!fieldValue) continue;
        
        if (fieldKey.toLowerCase().includes('epic') || fieldKey.toLowerCase().includes('parent')) {
          if (typeof fieldValue === 'string' && /^[A-Z]+-\d+$/.test(fieldValue)) {
            return fieldValue;
          }
          if (fieldValue && typeof fieldValue === 'object' && fieldValue.key && /^[A-Z]+-\d+$/.test(fieldValue.key)) {
            return fieldValue.key;
          }
        }
      }
      
      return null;
    }
    
    // Extract epic keys (exclude Epic type issues)
    for (const issue of filteredIssues) {
      const issueType = issue.fields?.issuetype?.name;
      
      if (issueType === 'Epic') {
        continue;
      }
      
      const epicKey = extractEpicKey(issue);
      if (epicKey) {
        epicKeysSet.add(epicKey);
      } else {
        issuesWithoutEpic.push(issue);
      }
    }
    
    // Build epic data
    const epicKeys = Array.from(epicKeysSet);
    const epics = [];
    
    // Group issues by epic
    const issuesByEpic = {};
    for (const issue of filteredIssues) {
      if (issue.fields?.issuetype?.name === 'Epic') continue;
      
      const epicKey = extractEpicKey(issue);
      if (epicKey) {
        if (!issuesByEpic[epicKey]) {
          issuesByEpic[epicKey] = [];
        }
        issuesByEpic[epicKey].push(issue);
      }
    }
    
    // Fetch epic details and all issues for each epic
    let rateLimited = false;
    for (let i = 0; i < epicKeys.length; i++) {
      const epicKey = epicKeys[i];
      
      // Add a small delay between epic fetches to avoid rate limiting (except for first one)
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 300)); // 300ms delay
      }
      
      // Get user's issues for this epic
      const userEpicIssues = issuesByEpic[epicKey] || [];
      
      // Fetch epic details first and save them
      let epicName = epicKey;
      let epicStatus = 'Unknown';
      let epicProject = '';
      
      try {
        const response = await jiraApi.get(`/rest/api/2/issue/${epicKey}`, {
          params: { fields: 'summary,status,project' }
        });
        epicName = response.data.fields?.summary || epicKey;
        epicStatus = response.data.fields?.status?.name || 'Unknown';
        epicProject = response.data.fields?.project?.key || '';
      } catch (error) {
        // Epic fetch failed - try to get name from issues
        if (userEpicIssues.length > 0) {
          const firstIssue = userEpicIssues[0];
          if (firstIssue.fields?.epicName) {
            epicName = firstIssue.fields.epicName;
          }
          if (firstIssue.fields?.project?.key) {
            epicProject = firstIssue.fields.project.key;
          }
        }
      }
      
      try {
        // Fetch ALL issues for this epic (not just user's issues)
        // If this fails due to rate limiting, we'll use user's issues as fallback
        let allEpicIssues = [];
        if (!rateLimited) {
          try {
            allEpicIssues = await getAllIssuesForEpic(epicKey);
          } catch (epicError) {
            // If we can't fetch all issues (e.g., rate limited), use user's issues
            if (epicError.response?.status === 429) {
              console.warn(`Rate limited when fetching all issues for epic ${epicKey}. Using user's issues only for remaining epics.`);
              rateLimited = true;
              allEpicIssues = userEpicIssues;
            } else {
              // For other errors, still try to use user's issues
              allEpicIssues = userEpicIssues;
            }
          }
        } else {
          // Already rate limited, skip fetching all issues
          allEpicIssues = userEpicIssues;
        }
        
        // Calculate metrics for ALL epic issues
        const allDoneIssues = allEpicIssues.filter(i => i.fields?.resolutiondate || ['Done', 'Closed', 'Resolved'].includes(i.fields?.status?.name));
        const epicTotalPoints = allEpicIssues.reduce((sum, i) => sum + getStoryPoints(i), 0);
        const epicCompletedPoints = allDoneIssues.reduce((sum, i) => sum + getStoryPoints(i), 0);
        
        // Calculate metrics for user's issues only
        const userDoneIssues = userEpicIssues.filter(i => i.fields?.resolutiondate || ['Done', 'Closed', 'Resolved'].includes(i.fields?.status?.name));
        const userTotalPoints = userEpicIssues.reduce((sum, i) => sum + getStoryPoints(i), 0);
        const userCompletedPoints = userDoneIssues.reduce((sum, i) => sum + getStoryPoints(i), 0);
        
        // Find most recent update date from all epic issues
        const mostRecentUpdate = allEpicIssues.length > 0
          ? Math.max(...allEpicIssues.map(issue => new Date(issue.fields?.updated || 0).getTime()))
          : 0;
        
        // Build issue type breakdown from ALL epic issues
        const issueTypeBreakdown = {};
        allEpicIssues.forEach(issue => {
          const type = issue.fields?.issuetype?.name || 'Unknown';
          issueTypeBreakdown[type] = (issueTypeBreakdown[type] || 0) + 1;
        });
        
        // Map user's issues to frontend expected format
        const mappedIssues = userEpicIssues.map(issue => ({
          key: issue.key,
          summary: issue.fields?.summary || '',
          status: issue.fields?.status?.name || 'Unknown',
          storyPoints: getStoryPoints(issue)
        }));
        
        epics.push({
          epicKey: epicKey,
          epicName: epicName,
          status: epicStatus,
          project: epicProject,
          issues: mappedIssues,
          issueTypeBreakdown,
          mostRecentUpdate: mostRecentUpdate,
          metrics: {
            epicTotalIssues: allEpicIssues.length,
            epicTotalPoints: epicTotalPoints,
            userTotalIssuesAllTime: userEpicIssues.length,
            userTotalPointsAllTime: userTotalPoints,
            totalIssues: allEpicIssues.length,
            totalDoneIssues: allDoneIssues.length,
            storyPointsCompleted: epicCompletedPoints,
            remainingStoryPoints: epicTotalPoints - epicCompletedPoints
          }
        });
      } catch (error) {
        // If getAllIssuesForEpic fails, still create epic with user's issues
        let allEpicIssues = [];
        if (!rateLimited) {
          try {
            allEpicIssues = await getAllIssuesForEpic(epicKey);
          } catch (epicError) {
            // If we can't fetch all issues (rate limited or other error), use user's issues as fallback
            if (epicError.response?.status === 429) {
              console.warn(`Rate limited when fetching all issues for epic ${epicKey} in catch block. Using user's issues only for remaining epics.`);
              rateLimited = true;
            }
            allEpicIssues = userEpicIssues;
          }
        } else {
          // Already rate limited, skip fetching all issues
          allEpicIssues = userEpicIssues;
        }
        
        // If epic name wasn't fetched earlier, try to get it from issues
        if (epicName === epicKey && allEpicIssues.length > 0) {
          const firstIssue = allEpicIssues[0];
          if (firstIssue.fields?.epicName) {
            epicName = firstIssue.fields.epicName;
          }
          if (!epicProject && firstIssue.fields?.project?.key) {
            epicProject = firstIssue.fields.project.key;
          }
        }
        
        // Calculate metrics for ALL epic issues
        const allDoneIssues = allEpicIssues.filter(i => i.fields?.resolutiondate || ['Done', 'Closed', 'Resolved'].includes(i.fields?.status?.name));
        const epicTotalPoints = allEpicIssues.reduce((sum, i) => sum + getStoryPoints(i), 0);
        const epicCompletedPoints = allDoneIssues.reduce((sum, i) => sum + getStoryPoints(i), 0);
        
        // Calculate metrics for user's issues only
        const userDoneIssues = userEpicIssues.filter(i => i.fields?.resolutiondate || ['Done', 'Closed', 'Resolved'].includes(i.fields?.status?.name));
        const userTotalPoints = userEpicIssues.reduce((sum, i) => sum + getStoryPoints(i), 0);
        const userCompletedPoints = userDoneIssues.reduce((sum, i) => sum + getStoryPoints(i), 0);
        
        // Find most recent update date from all epic issues
        const mostRecentUpdate = allEpicIssues.length > 0
          ? Math.max(...allEpicIssues.map(issue => new Date(issue.fields?.updated || 0).getTime()))
          : 0;
        
        // Build issue type breakdown from ALL epic issues
        const issueTypeBreakdown = {};
        allEpicIssues.forEach(issue => {
          const type = issue.fields?.issuetype?.name || 'Unknown';
          issueTypeBreakdown[type] = (issueTypeBreakdown[type] || 0) + 1;
        });
        
        // Map user's issues to frontend expected format
        const mappedIssues = userEpicIssues.map(issue => ({
          key: issue.key,
          summary: issue.fields?.summary || '',
          status: issue.fields?.status?.name || 'Unknown',
          storyPoints: getStoryPoints(issue)
        }));
        
        epics.push({
          epicKey: epicKey,
          epicName: epicName,
          status: epicStatus,
          project: epicProject,
          issues: mappedIssues,
          issueTypeBreakdown,
          mostRecentUpdate: mostRecentUpdate,
          metrics: {
            epicTotalIssues: allEpicIssues.length,
            epicTotalPoints: epicTotalPoints,
            userTotalIssuesAllTime: userEpicIssues.length,
            userTotalPointsAllTime: userTotalPoints,
            totalIssues: allEpicIssues.length,
            totalDoneIssues: allDoneIssues.length,
            storyPointsCompleted: epicCompletedPoints,
            remainingStoryPoints: epicTotalPoints - epicCompletedPoints
          }
        });
      }
    }
    
    // Sort epics by most recent ticket activity (most recent first)
    epics.sort((a, b) => (b.mostRecentUpdate || 0) - (a.mostRecentUpdate || 0));
    
    // Map issues without epic to frontend format
    const mappedIssuesWithoutEpic = issuesWithoutEpic.slice(0, 20).map(issue => ({
      key: issue.key,
      summary: issue.fields?.summary || '',
      status: issue.fields?.status?.name || 'Unknown',
      storyPoints: getStoryPoints(issue)
    }));
    
    const result = {
      epics,
      issuesWithoutEpic: issuesWithoutEpic.length,
      issuesWithoutEpicList: mappedIssuesWithoutEpic,
      totalEpics: epics.length
    };
    
    cache.set(cacheKey, result, 120);
    return result;
  } catch (error) {
    console.error('Error fetching projects by epic:', error.message);
    throw error;
  }
}

/**
 * Get future sprints for boards
 * @param {Array<number>} boardIds - Array of board IDs
 * @returns {Promise<Array>} Future sprints
 */
async function getFutureSprints(boardIds) {
  const futureSprints = [];
  const now = new Date();
  
  for (const boardId of boardIds) {
    try {
      const response = await jiraApi.get(`/rest/agile/1.0/board/${boardId}/sprint`, {
        params: { state: 'future,active' }
      });
      
      if (response.data?.values) {
        for (const sprint of response.data.values) {
          if (sprint.state === 'future' || (sprint.state === 'active' && sprint.endDate)) {
            const endDate = sprint.endDate ? new Date(sprint.endDate) : null;
            if (!endDate || endDate > now) {
              futureSprints.push({
                id: sprint.id,
                name: sprint.name,
                state: sprint.state,
                boardId: boardId,
                startDate: sprint.startDate ? new Date(sprint.startDate) : null,
                endDate: endDate
              });
            }
          }
        }
      }
    } catch (error) {
      // Board might not exist or no permission
    }
  }
  
  return futureSprints;
}

// Export public API
module.exports = {
  // Main stats functions
  getStats,
  getAllIssuesForPage,
  getProjectsByEpic,
  getCTOIStats,
  
  // Utility functions (for use by other modules if needed)
  getCurrentUser,
  getAllIssues,
  calculateStats,
  calculateVelocity,
  calculateCycleTimeByPriority,
  getStoryPoints,
  getIssuePriority,
  isInESPNWebScope,
  getFutureSprints,
  
  // Sprint utilities
  findSprintField,
  extractSprintInfo,
  getAllSprints,
  getBestSprintForIssue,
  getSprintName,
  getBoardIdsFromIssues,
  getBoardName,
  
  // Internal API (for direct API access if needed)
  jiraApi,
  isConfigured
};
