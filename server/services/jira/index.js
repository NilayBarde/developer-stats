/**
 * JIRA Service - Main entry point
 * Orchestrates all JIRA functionality and exports public API
 */

const { filterByDateRange, calculateMonthlyStats, calculateTimePeriodStats, formatDateRangeForResponse } = require('../../utils/dateHelpers');
const { jiraApi, getCurrentUser, getAllIssues, isConfigured, JIRA_PAT, JIRA_BASE_URL } = require('./api');
const { calculateCycleTimeByPriority, getIssuePriority, getInProgressDate } = require('./cycleTime');
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
 * @returns {Promise<Object>} JIRA stats
 */
async function getStats(dateRange = null) {
  if (!isConfigured()) {
    throw new Error('Jira credentials not configured. Please set JIRA_PAT and JIRA_BASE_URL environment variables.');
  }

  const cache = require('../../utils/cache');
  const cacheKey = `jira-stats:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ Jira stats served from cache');
    return cached;
  }

  console.log('📋 Fetching JIRA stats...');
  const startTime = Date.now();

  // Fetch both main stats and CTOI stats in parallel
  const [issues, ctoiStats] = await Promise.all([
    getAllIssues(dateRange),
    getCTOIStats(dateRange).catch(err => {
      console.warn('⚠️ Failed to fetch CTOI stats:', err.message);
      return null;
    })
  ]);
  
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
    const allIssues = await getAllIssues(dateRange);
    
    // Sort by updated date descending
    const sortedIssues = [...allIssues].sort((a, b) => {
      const dateA = new Date(a.fields.updated);
      const dateB = new Date(b.fields.updated);
      return dateB - dateA;
    });

    // Local filtering by date range
    let filteredIssues = sortedIssues;
    if (dateRange && (dateRange.start || dateRange.end)) {
      filteredIssues = sortedIssues.filter(issue => {
        const updated = new Date(issue.fields.updated);
        if (dateRange.start && updated < new Date(dateRange.start)) return false;
        if (dateRange.end && updated > new Date(dateRange.end)) return false;
        return true;
      });
    }
    
    // Filter by "In Progress" date if date range is specified
    if (dateRange && dateRange.start) {
      const rangeStart = new Date(dateRange.start);
      filteredIssues = filteredIssues.filter(issue => {
        if (issue._inProgressDate) {
          const inProgressDate = new Date(issue._inProgressDate);
          return inProgressDate >= rangeStart;
        }
        const updatedDate = issue.fields?.updated ? new Date(issue.fields.updated) : null;
        if (updatedDate) {
          return updatedDate >= rangeStart;
        }
        return false;
      });
    }
    
    cache.set(cacheKey, filteredIssues, 120);
    return filteredIssues;
  } catch (error) {
    console.error('Error fetching issues page:', error.message);
    throw error;
  }
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
  const cacheKey = `projects-by-epic-v2:${JSON.stringify(dateRange)}`;
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
    
    // Fetch epic details
    for (const epicKey of epicKeys) {
      try {
        const response = await jiraApi.get(`/rest/api/2/issue/${epicKey}`, {
          params: { fields: 'summary,status,project' }
        });
        
        const epicIssues = issuesByEpic[epicKey] || [];
        const resolvedCount = epicIssues.filter(i => i.fields?.resolutiondate).length;
        const totalPoints = epicIssues.reduce((sum, i) => sum + getStoryPoints(i), 0);
        
        epics.push({
          key: epicKey,
          summary: response.data.fields?.summary || epicKey,
          status: response.data.fields?.status?.name || 'Unknown',
          project: response.data.fields?.project?.key || '',
          issues: epicIssues,
          issueCount: epicIssues.length,
          resolvedCount: resolvedCount,
          totalPoints: totalPoints
        });
      } catch (error) {
        // Epic not found - still include with available data
        const epicIssues = issuesByEpic[epicKey] || [];
        epics.push({
          key: epicKey,
          summary: epicKey,
          status: 'Unknown',
          project: '',
          issues: epicIssues,
          issueCount: epicIssues.length,
          resolvedCount: epicIssues.filter(i => i.fields?.resolutiondate).length,
          totalPoints: epicIssues.reduce((sum, i) => sum + getStoryPoints(i), 0)
        });
      }
    }
    
    // Sort epics by issue count descending
    epics.sort((a, b) => b.issueCount - a.issueCount);
    
    const result = {
      epics,
      issuesWithoutEpic: issuesWithoutEpic.length,
      issuesWithoutEpicList: issuesWithoutEpic.slice(0, 20),
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
