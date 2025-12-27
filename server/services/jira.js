const axios = require('axios');
const { filterByDateRange, calculateMonthlyStats, calculateTimePeriodStats, formatDateRangeForResponse } = require('../utils/dateHelpers');

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

async function getCurrentUser() {
  try {
    const response = await jiraApi.get('/rest/api/2/myself');
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

async function getAllIssues(dateRange = null) {
  // Check cache for raw issues (cache for 10 minutes - issues don't change that often)
  // Cache based on date range to allow faster initial loads for smaller ranges
  // Use 'jira-raw-issues' prefix to avoid collision with endpoint cache ('issues')
  const cache = require('../utils/cache');
  const cacheKey = `jira-raw-issues:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ Raw issues served from cache');
    return cached;
  }
  
  const issues = [];
  let startAt = 0;
  const maxResults = 100;
  let hasMore = true;
  
  // Get current user info first to use their accountId or email
  // Cache user info for 10 minutes (rarely changes)
  const userCacheKey = 'jira-user';
  let cachedUser = cache.get(userCacheKey);
  let userAccountId = null;
  let userEmail = null;
  
  if (cachedUser) {
    userAccountId = cachedUser.accountId;
    userEmail = cachedUser.emailAddress;
  } else {
    try {
      const user = await getCurrentUser();
      userAccountId = user.accountId;
      userEmail = user.emailAddress;
      cache.set(userCacheKey, { accountId: userAccountId, emailAddress: userEmail }, 600); // 10 minutes
    } catch (error) {
      // Silently fail - will try alternative JQL queries
    }
  }

  // Don't filter by date in JQL - we want ALL issues to capture all sprints
  // Sprint date filtering happens later in calculateVelocity based on sprint dates
  // This ensures sprints from before the date range are included if they overlap
  // Apply date filter if provided (optimizes initial load)
  // Use 'updated' to capture any issue active during the period
  let jqlDateFilter = '';
  if (dateRange && dateRange.start) {
    jqlDateFilter = ` AND updated >= "${dateRange.start}"`;
  }
  if (dateRange && dateRange.end) {
    jqlDateFilter += ` AND updated <= "${dateRange.end}"`;
  }

  // Try different JQL queries - API tokens may restrict currentUser() even if web UI allows it
  const baseQueries = [
    `assignee = currentUser()${jqlDateFilter}`, // Try currentUser() first
    userEmail ? `assignee = "${userEmail}"${jqlDateFilter}` : null, // Fallback to email
    userAccountId ? `assignee = ${userAccountId}${jqlDateFilter}` : null // Try accountId if available
  ].filter(Boolean);
  
  const jqlQueries = baseQueries.map(base => `${base} ORDER BY created DESC`);

  // Only fetch fields we actually need to reduce payload size
  const requiredFields = [
    'key', 'summary', 'status', 'created', 'updated', 'resolutiondate',
    'issuetype', 'project', 'timespent', 'timeoriginalestimate',
    'assignee', 'reporter', 'priority', 'description',
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
      const response = await jiraApi.post('/rest/api/2/search', {
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

  // Cache raw issues for 10 minutes (uses jira-raw-issues prefix)
  cache.set(cacheKey, issues, 600);
  return issues;
}

function getStoryPoints(issue) {
  // Try multiple common story point field IDs
  // Different Jira instances use different custom field IDs
  // Based on debug logs, Disney Jira uses: 10106, 21766
  
  // Check all possible story point fields (prioritize Disney-specific ones first)
  const storyPointFields = [
    'customfield_10106', // Disney Jira story points (found in logs)
    'customfield_21766', // Disney Jira story points (found in logs)
    'customfield_10016', // Common in Jira Cloud
    'customfield_10021', // Another common one
    'customfield_10002', // Sometimes used
    'customfield_10004', // Sometimes used
    'customfield_10020', // Can be story points (but also sprints)
    'storyPoints'        // Direct field name
  ];
  
  for (const fieldName of storyPointFields) {
    const fieldValue = issue.fields?.[fieldName];
    if (fieldValue !== undefined && fieldValue !== null && fieldValue !== '') {
      const points = Number(fieldValue);
      if (!isNaN(points) && points > 0) {
        return points;
      }
    }
  }
  
  // Fallback: estimate story points from time estimate (8 hours = 1 story point)
  if (issue.fields?.timeoriginalestimate) {
    const estimatedPoints = issue.fields.timeoriginalestimate / 3600 / 8;
    if (estimatedPoints > 0) {
      return Math.round(estimatedPoints * 10) / 10;
    }
  }
  
  return 0;
}

/**
 * Get status transition time from changelog
 * Returns the date when status changed to the target status, or null if not found
 */
function getStatusTransitionTime(issue, targetStatusName) {
  // Changelog might be in issue.changelog or issue.changelog.histories
  let histories = null;
  
  if (issue.changelog) {
    if (Array.isArray(issue.changelog.histories)) {
      histories = issue.changelog.histories;
    } else if (issue.changelog.histories && Array.isArray(issue.changelog.histories.values)) {
      histories = issue.changelog.histories.values;
    }
  }
  
  if (!histories || histories.length === 0) {
    return null;
  }

  // Normalize status name for comparison (case-insensitive, trim whitespace)
  const normalizedTarget = targetStatusName.toLowerCase().trim();
  
  // Sort by date ascending to find the first occurrence
  const sortedHistories = [...histories].sort((a, b) => {
    const dateA = new Date(a.created || 0);
    const dateB = new Date(b.created || 0);
    return dateA - dateB;
  });
  
  for (const history of sortedHistories) {
    if (!history.items) continue;
    
    for (const item of history.items) {
      if (item.field === 'status' && item.toString) {
        const toStatus = item.toString.toLowerCase().trim();
        if (toStatus === normalizedTarget) {
          return new Date(history.created);
        }
      }
    }
  }
  
  return null;
}

/**
 * Calculate time from "In Progress" to "Ready for QA Release" (or similar QA-ready statuses)
 * Returns time in days, or null if either status transition not found
 */
function calculateInProgressToQAReadyTime(issue) {
  // Try multiple variations of "In Progress" status name
  const inProgressVariations = [
    'In Progress',
    'In Progress',
    'in progress',
    'IN PROGRESS',
    'InProgress'
  ];
  
  // Try multiple variations of QA-ready status names
  const qaReadyVariations = [
    'Ready for QA Release',
    'Ready for QA',
    'QA Ready',
    'Ready for QA Release',
    'Ready for Testing',
    'QA Release',
    'Ready for QA Release'
  ];
  
  let inProgressTime = null;
  for (const statusName of inProgressVariations) {
    inProgressTime = getStatusTransitionTime(issue, statusName);
    if (inProgressTime) break;
  }
  
  if (!inProgressTime) {
    return null; // Can't calculate if we don't have "In Progress" transition
  }
  
  let qaReadyTime = null;
  for (const statusName of qaReadyVariations) {
    qaReadyTime = getStatusTransitionTime(issue, statusName);
    if (qaReadyTime) break;
  }
  
  // If no QA-ready status found, use resolution date as fallback
  if (!qaReadyTime && issue.fields?.resolutiondate) {
    qaReadyTime = new Date(issue.fields.resolutiondate);
  }
  
  if (!qaReadyTime) {
    return null; // Can't calculate if we don't have end time
  }
  
  // Ensure QA-ready time is after in-progress time
  if (qaReadyTime < inProgressTime) {
    return null;
  }
  
  return (qaReadyTime - inProgressTime) / (1000 * 60 * 60 * 24); // days
}

function parseSprintString(sprintString) {
  // Parse sprint string like: "com.atlassian.greenhopper.service.sprint.Sprint@...[...]"
  // Extract key-value pairs from the bracket content
  const match = sprintString.match(/\[(.*)\]/);
  if (!match) return null;
  
  const content = match[1];
  const sprintData = {};
  
  // Parse key=value pairs
  const pairs = content.split(',').map(p => p.trim());
  pairs.forEach(pair => {
    const [key, ...valueParts] = pair.split('=');
    if (key && valueParts.length > 0) {
      let value = valueParts.join('=');
      // Handle <null> values
      if (value === '<null>') {
        value = null;
      } else if (value && !isNaN(value) && value !== '') {
        // Try to parse as number
        const numValue = Number(value);
        if (!isNaN(numValue)) {
          value = numValue;
        }
      }
      sprintData[key.trim()] = value;
    }
  });
  
  return sprintData;
}

function extractSprintInfo(sprintField, resolvedDate, issueKey = null) {
  // Sprint field can be an array or single object
  if (!sprintField) return null;
  
  // Handle string representation of sprint (customfield_10105 format)
  if (typeof sprintField === 'string' && sprintField.includes('com.atlassian.greenhopper.service.sprint.Sprint')) {
    const sprintData = parseSprintString(sprintField);
    if (sprintData && sprintData.id) {
      return {
        id: sprintData.id,
        name: sprintData.name || `Sprint ${sprintData.id}`,
        state: sprintData.state,
        startDate: sprintData.startDate ? new Date(sprintData.startDate) : null,
        endDate: sprintData.endDate ? new Date(sprintData.endDate) : null,
        completeDate: sprintData.completeDate ? new Date(sprintData.completeDate) : null,
        rapidViewId: sprintData.rapidViewId
      };
    }
  }
  
  // Handle array of sprint strings
  if (Array.isArray(sprintField) && sprintField.length > 0) {
    // Check if first item is a string representation
    if (typeof sprintField[0] === 'string' && sprintField[0].includes('com.atlassian.greenhopper.service.sprint.Sprint')) {
      const sprints = sprintField.map(s => parseSprintString(s)).filter(Boolean);
      if (sprints.length === 0) return null;
      
      // Sort by start date (earliest first)
      sprints.sort((a, b) => {
        const dateA = a.startDate ? new Date(a.startDate) : null;
        const dateB = b.startDate ? new Date(b.startDate) : null;
        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;
        return dateA - dateB;
      });
      
      const selectedSprint = sprints[0];
      return {
        id: selectedSprint.id,
        name: selectedSprint.name || `Sprint ${selectedSprint.id}`,
        state: selectedSprint.state,
        startDate: selectedSprint.startDate ? new Date(selectedSprint.startDate) : null,
        endDate: selectedSprint.endDate ? new Date(selectedSprint.endDate) : null,
        completeDate: selectedSprint.completeDate ? new Date(selectedSprint.completeDate) : null,
        rapidViewId: selectedSprint.rapidViewId
      };
    }
  }
  
  const sprints = Array.isArray(sprintField) ? sprintField : [sprintField];
  if (sprints.length === 0) return null;
  
  // If issue is in multiple sprints, use the FIRST sprint (by start date)
  // This ensures each issue is only counted once, in its earliest sprint
  let selectedSprint = null;
  
  if (sprints.length === 1) {
    selectedSprint = sprints[0];
  } else {
    // Sort sprints by start date (earliest first)
    const sprintsWithDates = sprints
      .map(sprint => {
        if (typeof sprint === 'object' && sprint !== null) {
          const startDate = sprint.startDate ? new Date(sprint.startDate) : null;
          return { sprint, startDate };
        }
        return { sprint, startDate: null };
      })
      .filter(item => item.sprint !== null && item.sprint !== undefined)
      .sort((a, b) => {
        // Sort by start date ascending (earliest first)
        if (!a.startDate && !b.startDate) return 0;
        if (!a.startDate) return 1; // No date goes to end
        if (!b.startDate) return -1; // No date goes to end
        return a.startDate - b.startDate;
      });
    
    // Use the first sprint (earliest start date)
    if (sprintsWithDates.length > 0) {
      selectedSprint = sprintsWithDates[0].sprint;
    } else {
      // Fallback: if no dates available, use first in array
      selectedSprint = sprints[0];
    }
  }
  
  // Sprint can be an object with id, name, state, startDate, endDate, etc.
  if (typeof selectedSprint === 'object' && selectedSprint !== null) {
    return {
      id: selectedSprint.id || selectedSprint.sprintId,
      name: selectedSprint.name || selectedSprint.value,
      state: selectedSprint.state,
      startDate: selectedSprint.startDate ? new Date(selectedSprint.startDate) : null,
      endDate: selectedSprint.endDate ? new Date(selectedSprint.endDate) : null,
      completeDate: selectedSprint.completeDate ? new Date(selectedSprint.completeDate) : null,
      boardId: selectedSprint.boardId,
      boardName: selectedSprint.boardName,
      rapidViewId: selectedSprint.rapidViewId
    };
  }
  
  // If it's just a string/ID, return basic info
  if (typeof selectedSprint === 'string' || typeof selectedSprint === 'number') {
    return {
      id: selectedSprint,
      name: `Sprint ${selectedSprint}`,
      state: null,
      startDate: null,
      endDate: null
    };
  }
  
  return null;
}

function findSprintField(issue) {
  // Check common sprint field IDs first - but only if they have actual data
  // customfield_10105 is the sprint field for Disney Jira (found in logs)
  const commonSprintFields = ['customfield_10105', 'customfield_10020', 'customfield_10007', 'customfield_10000'];
  for (const fieldId of commonSprintFields) {
    const fieldValue = issue.fields[fieldId];
    // Check if field exists and has data (not empty array or null)
    if (fieldValue && 
        ((Array.isArray(fieldValue) && fieldValue.length > 0) || 
         (!Array.isArray(fieldValue) && fieldValue !== null && fieldValue !== ''))) {
      // Check for string representation of sprint (customfield_10105 format)
      if (typeof fieldValue === 'string' && fieldValue.includes('com.atlassian.greenhopper.service.sprint.Sprint')) {
        return fieldId;
      }
      // Verify it's actually sprint data (has sprint-specific properties)
      if (Array.isArray(fieldValue) && fieldValue.length > 0) {
        const firstItem = fieldValue[0];
        // Check for string representation
        if (typeof firstItem === 'string' && firstItem.includes('com.atlassian.greenhopper.service.sprint.Sprint')) {
          return fieldId;
        }
        // Check for object representation
        if (firstItem && typeof firstItem === 'object' && 
            (firstItem.startDate || firstItem.endDate || firstItem.sprintId || 
             (firstItem.name && firstItem.name.toLowerCase().includes('sprint')))) {
          return fieldId;
        }
      }
    }
  }
  
  // Search all fields for sprint-like data - must have sprint-specific properties
  for (const [fieldKey, fieldValue] of Object.entries(issue.fields || {})) {
    // Skip known non-sprint fields
    if (['resolution', 'status', 'priority', 'issuetype', 'project'].includes(fieldKey)) {
      continue;
    }
    
    if (Array.isArray(fieldValue) && fieldValue.length > 0) {
      const firstItem = fieldValue[0];
      if (typeof firstItem === 'object' && firstItem !== null) {
        // Must have sprint-specific properties
        if ((firstItem.startDate || firstItem.endDate || firstItem.sprintId || 
             firstItem.boardId || firstItem.rapidViewId ||
             (firstItem.name && firstItem.name.toLowerCase().includes('sprint')))) {
          return fieldKey;
        }
      }
    } else if (fieldValue && typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
      // Must have sprint-specific properties
      if ((fieldValue.startDate || fieldValue.endDate || fieldValue.sprintId || 
           fieldValue.boardId || fieldValue.rapidViewId ||
           (fieldValue.name && fieldValue.name.toLowerCase().includes('sprint')))) {
        return fieldKey;
      }
    }
  }
  return null;
}

function getBoardName(sprintName, rapidViewId) {
  // Identify board from sprint name
  if (!sprintName) return 'Unknown';
  
  const nameLower = sprintName.toLowerCase();
  if (nameLower.includes('bet')) {
    return 'Bet';
  } else if (nameLower.includes('sport') || nameLower.includes('sweb')) {
    return 'SPORTSWEB';
  }
  
  return 'Unknown';
}

function calculateVelocity(issues, dateRange = null) {
  const sprintsByBoard = {}; // Group sprints by board
  
  // Don't filter issues here - we want ALL issues that belong to sprints
  // We'll filter sprints by their sprint dates later, not by issue dates
  // This ensures sprints are included even if some issues were resolved outside the date range
  
  // Find sprint field ID - check multiple issues until we find one with sprint data
  let sprintFieldId = null;
  // Check all issues to find sprint field
  const issuesToCheck = issues;
  
  // Try up to 50 issues to find one with sprint data
  for (let i = 0; i < Math.min(50, issuesToCheck.length); i++) {
    const issue = issuesToCheck[i];
    
    // Check common sprint fields first (customfield_10105 is Disney Jira sprint field)
    const commonSprintFields = ['customfield_10105', 'customfield_10020', 'customfield_10007', 'customfield_10000'];
    for (const fieldId of commonSprintFields) {
      const fieldValue = issue.fields[fieldId];
      if (fieldValue) {
        // Check for string representation (customfield_10105 format)
        if (typeof fieldValue === 'string' && fieldValue.includes('com.atlassian.greenhopper.service.sprint.Sprint')) {
          sprintFieldId = fieldId;
          break;
        }
        // Check if array contains sprint data
        if (Array.isArray(fieldValue) && fieldValue.length > 0) {
          const firstItem = fieldValue[0];
          // Check for string representation
          if (typeof firstItem === 'string' && firstItem.includes('com.atlassian.greenhopper.service.sprint.Sprint')) {
            sprintFieldId = fieldId;
            break;
          }
          // Check if array contains sprint-like objects
          if (firstItem && typeof firstItem === 'object' && 
              (firstItem.startDate || firstItem.endDate || firstItem.sprintId || 
               firstItem.boardId || firstItem.rapidViewId ||
               (firstItem.name && firstItem.name.toLowerCase().includes('sprint')))) {
            sprintFieldId = fieldId;
            break;
          }
        }
      }
    }
    
    if (sprintFieldId) break;
    
    // Also try the general findSprintField function
    const foundFieldId = findSprintField(issue);
    if (foundFieldId && issue.fields[foundFieldId]) {
      const sprintData = issue.fields[foundFieldId];
      // Verify it has actual sprint data (not empty array)
      if ((Array.isArray(sprintData) && sprintData.length > 0) || 
          (!Array.isArray(sprintData) && sprintData !== null)) {
        sprintFieldId = foundFieldId;
        break;
      }
    }
  }
  
  // Group issues by sprint - only use actual sprint data from Jira
  // Include all issues (resolved and unresolved) to capture current sprint work
  // If issue is in multiple sprints, assign all points to the first sprint (earliest by start date)
  let issuesWithoutSprint = 0;
  issues.forEach(issue => {
    
    const storyPoints = getStoryPoints(issue);
    
    const sprintField = sprintFieldId 
      ? issue.fields[sprintFieldId]
      : (issue.fields.customfield_10020 || issue.fields.customfield_10007);
    
    const sprintInfo = extractSprintInfo(sprintField, issue.fields.resolutiondate, issue.key);
    
    // Only process issues that have actual sprint data with dates
    if (!sprintInfo || !sprintInfo.id || (!sprintInfo.startDate && !sprintInfo.endDate)) {
      issuesWithoutSprint++;
      return; // Skip issues without valid sprint data
    }
    
    // Require both start and end dates from Jira
    if (!sprintInfo.startDate || !sprintInfo.endDate) {
      issuesWithoutSprint++;
      return; // Skip issues without complete sprint date information
    }
    
    const sprintKey = `sprint-${sprintInfo.id}`;
    const sprintName = sprintInfo.name || `Sprint ${sprintInfo.id}`;
    const boardName = getBoardName(sprintName, sprintInfo.rapidViewId);
    
    // Initialize board if needed
    if (!sprintsByBoard[boardName]) {
      sprintsByBoard[boardName] = {};
    }
    
    if (!sprintsByBoard[boardName][sprintKey]) {
      sprintsByBoard[boardName][sprintKey] = {
        id: sprintInfo.id,
        name: sprintName,
        startDate: sprintInfo.startDate,
        endDate: sprintInfo.endDate,
        boardName: boardName,
        points: 0,
        issues: 0,
        timeSpent: 0,
        issueKeys: [] // Track issue keys for linking
      };
    }
    
    sprintsByBoard[boardName][sprintKey].points += storyPoints;
    sprintsByBoard[boardName][sprintKey].issues += 1;
    sprintsByBoard[boardName][sprintKey].timeSpent += (issue.fields.timespent || 0) / 3600;
    if (issue.key && !sprintsByBoard[boardName][sprintKey].issueKeys.includes(issue.key)) {
      sprintsByBoard[boardName][sprintKey].issueKeys.push(issue.key);
    }
  });
  

  // Collect all sprints from all boards
  const allSprints = [];
  for (const [boardName, sprints] of Object.entries(sprintsByBoard)) {
    for (const sprint of Object.values(sprints)) {
      allSprints.push(sprint);
    }
  }
  
  // Filter sprints by date range if provided
  let filteredSprints = allSprints;
    if (dateRange) {
    const { getDateRange } = require('../utils/dateHelpers');
      const range = getDateRange(dateRange);
      
    filteredSprints = allSprints.filter(sprint => {
        if (range.start === null && range.end === null) return true;
        
        const sprintStart = sprint.startDate ? new Date(sprint.startDate) : null;
        const sprintEnd = sprint.endDate ? new Date(sprint.endDate) : null;
        
        if (!sprintStart && !sprintEnd) return false;
        
        if (range.start && range.end) {
          const rangeStart = new Date(range.start);
          rangeStart.setHours(0, 0, 0, 0);
          const rangeEnd = new Date(range.end);
          rangeEnd.setHours(23, 59, 59, 999);
          if (sprintStart && sprintEnd) {
            return sprintStart <= rangeEnd && sprintEnd >= rangeStart;
          }
          if (sprintStart) return sprintStart <= rangeEnd && sprintStart >= rangeStart;
          if (sprintEnd) return sprintEnd >= rangeStart && sprintEnd <= rangeEnd;
        } else if (range.start) {
          const rangeStart = new Date(range.start);
          rangeStart.setHours(0, 0, 0, 0);
          if (sprintEnd) return sprintEnd >= rangeStart;
          if (sprintStart) return sprintStart >= rangeStart;
        } else if (range.end) {
          const rangeEnd = new Date(range.end);
          rangeEnd.setHours(23, 59, 59, 999);
          if (sprintStart) return sprintStart <= rangeEnd;
          if (sprintEnd) return sprintEnd <= rangeEnd;
        }
        
        return false;
      });
    }
    
  // Group sprints by overlapping time periods
  // Sprints that overlap in time are grouped together for averaging
  // Uses transitive closure: if A overlaps B and B overlaps C, then A, B, C are all grouped together
  const sprintGroups = [];
  const sprintToGroup = new Map(); // Maps sprint ID to group index
  
  // Helper function to check if two sprints overlap
  function sprintsOverlap(sprint1, sprint2) {
    const start1 = sprint1.startDate ? new Date(sprint1.startDate) : null;
    const end1 = sprint1.endDate ? new Date(sprint1.endDate) : null;
    const start2 = sprint2.startDate ? new Date(sprint2.startDate) : null;
    const end2 = sprint2.endDate ? new Date(sprint2.endDate) : null;
    
    if (!start1 || !end1 || !start2 || !end2) return false;
    
    // Sprints overlap if one starts before the other ends and vice versa
    return start1 <= end2 && end1 >= start2;
  }
  
  // Build groups using transitive closure
  for (const sprint of filteredSprints) {
    let assignedGroup = null;
    
    // Check if this sprint overlaps with any existing group
    for (let i = 0; i < sprintGroups.length; i++) {
      const group = sprintGroups[i];
      // If sprint overlaps with any sprint in this group, add it to the group
      if (group.some(existingSprint => sprintsOverlap(sprint, existingSprint))) {
        group.push(sprint);
        sprintToGroup.set(sprint.id, i);
        assignedGroup = i;
        break;
      }
    }
    
    // If no overlap found, create a new group
    if (assignedGroup === null) {
      sprintGroups.push([sprint]);
      sprintToGroup.set(sprint.id, sprintGroups.length - 1);
    }
  }
  
  // Merge groups that have transitive overlaps
  // If group A has a sprint that overlaps with group B, merge them
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < sprintGroups.length; i++) {
      for (let j = i + 1; j < sprintGroups.length; j++) {
        const groupI = sprintGroups[i];
        const groupJ = sprintGroups[j];
        
        // Check if any sprint in group I overlaps with any sprint in group J
        const hasOverlap = groupI.some(sprintI => 
          groupJ.some(sprintJ => sprintsOverlap(sprintI, sprintJ))
        );
        
        if (hasOverlap) {
          // Merge group J into group I
          sprintGroups[i] = [...groupI, ...groupJ];
          sprintGroups.splice(j, 1);
          merged = true;
          break;
        }
      }
      if (merged) break;
    }
  }
  
  // Calculate velocities for overlapping sprint groups
  // For overlapping sprints, SUM their points (since work happens concurrently)
  // Then calculate average velocity per time period
  const boardResults = {};
  const combinedSprintVelocities = []; // Store combined velocities for overlapping groups
  
  for (const group of sprintGroups) {
    // Sort group by date
    group.sort((a, b) => {
      const dateA = a.endDate || a.startDate;
      const dateB = b.endDate || b.startDate;
      return dateA - dateB;
    });
    
    // For overlapping sprints, SUM their points (work happens concurrently)
    const combinedPoints = group.reduce((sum, sprint) => sum + (sprint.points || 0), 0);
    
    // Only count groups with points > 0
    if (combinedPoints > 0) {
      combinedSprintVelocities.push(combinedPoints);
    }
    
    // Group sprints by board for display
    for (const sprint of group) {
      const boardName = sprint.boardName || 'Unknown';
      if (!boardResults[boardName]) {
        boardResults[boardName] = {
          sprints: [],
          averageVelocity: 0,
          totalSprints: 0
        };
      }
      boardResults[boardName].sprints.push(sprint);
    }
  }
  
  // Calculate overall average velocity from combined sprint velocities
  // Each overlapping group counts as one sprint with summed points
  const overallAvgVelocity = combinedSprintVelocities.length > 0
    ? combinedSprintVelocities.reduce((a, b) => a + b, 0) / combinedSprintVelocities.length
    : 0;
  
  // For each board, calculate its average (for display purposes)
  for (const [boardName, boardData] of Object.entries(boardResults)) {
    const boardVelocities = boardData.sprints
      .filter(sprint => sprint.points > 0)
      .map(sprint => sprint.points);
    
    const boardAvgVelocity = boardVelocities.length > 0
      ? boardVelocities.reduce((a, b) => a + b, 0) / boardVelocities.length
      : 0;
    
    boardResults[boardName] = {
      sprints: boardData.sprints.sort((a, b) => {
        const dateA = a.endDate || a.startDate;
        const dateB = b.endDate || b.startDate;
        return dateA - dateB;
      }),
      averageVelocity: Math.round(boardAvgVelocity * 10) / 10,
      totalSprints: boardData.sprints.length
    };
  }
  
  // Combined average velocity (overlapping sprints are summed, then averaged)
  const combinedAvgVelocity = Math.round(overallAvgVelocity * 10) / 10;

  return {
    byBoard: boardResults,
    sprints: Object.values(sprintsByBoard).flatMap(sprints => Object.values(sprints)).sort((a, b) => {
      const dateA = a.endDate || a.startDate;
      const dateB = b.endDate || b.startDate;
      return dateA - dateB;
    }), // Keep for backward compatibility
    averageVelocity: combinedAvgVelocity,
    combinedAverageVelocity: combinedAvgVelocity, // Explicit combined average
    totalSprints: Object.values(sprintsByBoard).reduce((sum, sprints) => sum + Object.keys(sprints).length, 0)
  };
}

// Removed fallback sprint calculation functions - we only use actual sprint data from Jira

async function calculateStats(issues, dateRange = null) {
  const now = new Date();
  
  // Filter issues by date range - use 'updated' to match issues page filtering
  // This shows issues the user worked on during the date range
  let filteredIssues = dateRange 
    ? filterByDateRange(issues, 'fields.updated', dateRange)
    : issues;

  // Further filter by "In Progress" date if available (to match issues page logic)
  // Fetch changelog for issues that need it to get "In Progress" dates
  if (dateRange && dateRange.start) {
    const rangeStart = new Date(dateRange.start);
    
    // Fetch changelog for all issues to get "In Progress" dates
    // This ensures accurate filtering by In Progress date
    const issuesNeedingChangelog = filteredIssues.filter(issue => !issue.changelog);
    
    // Fetch changelog in batches
    const batchSize = 20;
    for (let i = 0; i < issuesNeedingChangelog.length; i += batchSize) {
      const batch = issuesNeedingChangelog.slice(i, i + batchSize);
      await Promise.all(batch.map(async (issue) => {
        try {
          const response = await jiraApi.get(`/rest/api/2/issue/${issue.key}`, {
            params: { expand: 'changelog' }
          });
          issue.changelog = response.data.changelog;
        } catch (error) {
          // Silently fail
        }
      }));
    }
    
    // Filter by "In Progress" date for issues that have it
    filteredIssues = filteredIssues.filter(issue => {
      const inProgressDate = getInProgressDate(issue);
      if (inProgressDate) {
        return inProgressDate >= rangeStart;
      }
      // If no "In Progress" date, use updated date (already filtered above)
      return true;
    });
  }

  // Exclude closed unassigned tickets (cancelled/no work needed)
  filteredIssues = filteredIssues.filter(issue => {
    const statusName = issue.fields?.status?.name || '';
    const isClosed = ['Done', 'Closed', 'Resolved'].includes(statusName);
    const isUnassigned = !issue.fields?.assignee;
    
    // Exclude closed unassigned tickets
    if (isClosed && isUnassigned) {
      return false;
    }
    
    return true;
  });
  
  // Exclude User Story issue types (these are containers, not actual work items)
  filteredIssues = filteredIssues.filter(issue => 
    issue.fields?.issuetype?.name !== 'User Story'
  );

  // Basic stats - use 'updated' for time period stats to match filtering
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

  // Calculate average resolution time (from In Progress to Ready for QA Release)
  // Note: This tracks time from when ticket goes to "In Progress" to "Ready for QA Release"
  const resolvedIssues = filteredIssues.filter(issue => issue.fields.resolutiondate);
  let avgResolutionTime = 0;
  let resolutionTimeCount = 0;
  if (resolvedIssues.length > 0) {
    // Fetch changelog for all resolved issues that don't have it
    const issuesNeedingChangelog = resolvedIssues.filter(issue => !issue.changelog);
    
    // Fetch changelog in parallel (fetch for all resolved issues for accurate stats)
    const changelogPromises = issuesNeedingChangelog.map(async (issue) => {
      try {
        const response = await jiraApi.get(`/rest/api/2/issue/${issue.key}`, {
          params: { expand: 'changelog' }
        });
        issue.changelog = response.data.changelog;
      } catch (error) {
        // Silently fail - will use null for this issue's calculation
      }
      return issue;
    });
    
    // Wait for changelog fetches to complete
    await Promise.all(changelogPromises);
    
    const resolutionTimes = resolvedIssues
      .map(issue => calculateInProgressToQAReadyTime(issue))
      .filter(time => time !== null); // Only include issues where we can calculate the time
    
    resolutionTimeCount = resolutionTimes.length;
    if (resolutionTimes.length > 0) {
      avgResolutionTime = resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length;
    }
  }

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

  // Calculate total story points
  const totalStoryPoints = filteredIssues.reduce((sum, issue) => {
    return sum + getStoryPoints(issue);
  }, 0);

  // Calculate velocity
  const velocity = calculateVelocity(filteredIssues, dateRange);

  // Monthly stats - use 'updated' to match filtering logic
  const monthlyIssues = calculateMonthlyStats(filteredIssues, 'fields.updated', dateRange);

  // Helper function to sort issues by last updated date descending
  const sortByUpdatedDesc = (a, b) => {
    const dateA = new Date(a.fields?.updated || a.fields?.created || 0);
    const dateB = new Date(b.fields?.updated || b.fields?.created || 0);
    // Handle invalid dates
    if (isNaN(dateA.getTime())) return 1;
    if (isNaN(dateB.getTime())) return -1;
    return dateB - dateA;
  };

  // Get recently updated issues (sorted by last updated)
  // Return the 5 most recently updated issues
  const issuesToReturn = filteredIssues
    .filter(issue => issue.fields?.updated || issue.fields?.created) // Ensure we have a date
    .sort(sortByUpdatedDesc)
    .slice(0, 5);

  return {
    total: filteredIssues.length,
    ...timePeriodStats,
    resolved,
    inProgress,
    done,
    totalStoryPoints,
    avgResolutionTime: Math.round(avgResolutionTime * 10) / 10,
    avgResolutionTimeCount: resolutionTimeCount, // Track how many issues were used in calculation
    byType: byType,
    byProject: byProject,
    velocity: velocity,
    monthlyIssues: monthlyIssues.monthly,
    avgIssuesPerMonth: monthlyIssues.averagePerMonth,
    issues: issuesToReturn,
    dateRange: formatDateRangeForResponse(dateRange)
  };
}

async function getStats(dateRange = null) {
  if (!JIRA_PAT || !JIRA_BASE_URL) {
    throw new Error('Jira credentials not configured. Please set JIRA_PAT and JIRA_BASE_URL environment variables.');
  }

  // Check cache for stats (cache for 2 minutes)
  const cache = require('../utils/cache');
  const statsCacheKey = `jira-stats:${JSON.stringify(dateRange)}`;
  const cachedStats = cache.get(statsCacheKey);
  if (cachedStats) {
    console.log('✓ Jira stats served from cache');
    return cachedStats;
  }

  try {
    const issues = await getAllIssues(dateRange);
    const stats = await calculateStats(issues, dateRange);
    
    // Get user email from cache if available
    const userCacheKey = 'jira-user';
    const cachedUser = cache.get(userCacheKey);
    let userEmail = null;
    
    if (cachedUser) {
      userEmail = cachedUser.emailAddress;
    } else {
      try {
        const user = await getCurrentUser();
        userEmail = user.emailAddress;
        cache.set(userCacheKey, { accountId: user.accountId, emailAddress: userEmail }, 600); // 10 minutes
      } catch (error) {
        // User fetch failed, but we can still return stats
      }
    }
    
    const result = {
      ...stats,
      source: 'jira',
      email: userEmail,
      baseUrl: normalizedBaseURL
    };
    
    // Cache stats for 2 minutes
    cache.set(statsCacheKey, result, 120);
    
    return result;
  } catch (error) {
    console.error('❌ Error fetching Jira stats:', error.message);
    throw error;
  }
}

/**
 * Get all sprints from issue
 */
function getAllSprints(issue) {
  const sprintFieldId = findSprintField(issue);
  if (!sprintFieldId) return [];
  
  const sprintField = issue.fields[sprintFieldId];
  if (!sprintField) return [];
  
  const sprints = [];
  
  // Handle string representation
  if (typeof sprintField === 'string' && sprintField.includes('com.atlassian.greenhopper.service.sprint.Sprint')) {
    const sprintData = parseSprintString(sprintField);
    if (sprintData && sprintData.id) {
      sprints.push({
        id: sprintData.id,
        name: sprintData.name || `Sprint ${sprintData.id}`,
        startDate: sprintData.startDate ? new Date(sprintData.startDate) : null,
        endDate: sprintData.endDate ? new Date(sprintData.endDate) : null,
        rapidViewId: sprintData.rapidViewId
      });
    }
  }
  // Handle array of sprint strings
  else if (Array.isArray(sprintField) && sprintField.length > 0) {
    if (typeof sprintField[0] === 'string' && sprintField[0].includes('com.atlassian.greenhopper.service.sprint.Sprint')) {
      sprintField.forEach(s => {
        const sprintData = parseSprintString(s);
        if (sprintData && sprintData.id) {
          sprints.push({
            id: sprintData.id,
            name: sprintData.name || `Sprint ${sprintData.id}`,
            startDate: sprintData.startDate ? new Date(sprintData.startDate) : null,
            endDate: sprintData.endDate ? new Date(sprintData.endDate) : null,
            rapidViewId: sprintData.rapidViewId
          });
        }
      });
    } else {
      // Handle array of sprint objects
      sprintField.forEach(sprint => {
        if (typeof sprint === 'object' && sprint !== null) {
          sprints.push({
            id: sprint.id || sprint.sprintId,
            name: sprint.name || sprint.value || `Sprint ${sprint.id || sprint.sprintId}`,
            startDate: sprint.startDate ? new Date(sprint.startDate) : null,
            endDate: sprint.endDate ? new Date(sprint.endDate) : null,
            rapidViewId: sprint.rapidViewId
          });
        }
      });
    }
  }
  // Handle single sprint object
  else if (typeof sprintField === 'object' && sprintField !== null && !Array.isArray(sprintField)) {
    sprints.push({
      id: sprintField.id || sprintField.sprintId,
      name: sprintField.name || sprintField.value || `Sprint ${sprintField.id || sprintField.sprintId}`,
      startDate: sprintField.startDate ? new Date(sprintField.startDate) : null,
      endDate: sprintField.endDate ? new Date(sprintField.endDate) : null,
      rapidViewId: sprintField.rapidViewId
    });
  }
  
  return sprints;
}

/**
 * Get the best sprint for an issue (the sprint that overlaps with "In Progress" date, or most recent)
 */
function getBestSprintForIssue(issue) {
  const sprints = getAllSprints(issue);
  if (sprints.length === 0) return null;
  if (sprints.length === 1) return sprints[0];
  
  // Get "In Progress" date if available
  const inProgressDate = getInProgressDate(issue);
  
  if (inProgressDate) {
    // Find sprint that overlaps with "In Progress" date
    for (const sprint of sprints) {
      if (sprint.startDate && sprint.endDate) {
        const sprintStart = new Date(sprint.startDate);
        const sprintEnd = new Date(sprint.endDate);
        // Check if "In Progress" date falls within sprint dates
        if (inProgressDate >= sprintStart && inProgressDate <= sprintEnd) {
          return sprint;
        }
      }
    }
    
    // If no sprint overlaps, find the sprint that started closest to "In Progress" date
    let closestSprint = null;
    let minDiff = Infinity;
    for (const sprint of sprints) {
      if (sprint.startDate) {
        const sprintStart = new Date(sprint.startDate);
        const diff = Math.abs(inProgressDate - sprintStart);
        if (diff < minDiff) {
          minDiff = diff;
          closestSprint = sprint;
        }
      }
    }
    if (closestSprint) return closestSprint;
  }
  
  // Fall back to most recent sprint (by end date, or start date if no end date)
  sprints.sort((a, b) => {
    const dateA = a.endDate ? new Date(a.endDate) : (a.startDate ? new Date(a.startDate) : new Date(0));
    const dateB = b.endDate ? new Date(b.endDate) : (b.startDate ? new Date(b.startDate) : new Date(0));
    return dateB - dateA; // Most recent first
  });
  
  return sprints[0];
}

/**
 * Get sprint name from issue (using best sprint selection)
 */
function getSprintName(issue) {
  const sprint = getBestSprintForIssue(issue);
  return sprint ? sprint.name : null;
}

/**
 * Get board IDs from issues (extract unique rapidViewIds)
 */
function getBoardIdsFromIssues(issues) {
  const boardIds = new Set();
  
  for (const issue of issues) {
    const sprintFieldId = findSprintField(issue);
    if (!sprintFieldId) continue;
    
    const sprintInfo = extractSprintInfo(issue.fields[sprintFieldId], issue.fields?.resolutiondate, issue.key);
    if (sprintInfo && sprintInfo.rapidViewId) {
      boardIds.add(sprintInfo.rapidViewId);
    }
  }
  
  return Array.from(boardIds);
}

/**
 * Fetch future sprints from Jira Agile API
 */
async function getFutureSprints(boardIds) {
  const futureSprints = [];
  
  for (const boardId of boardIds) {
    try {
      // Try Agile API endpoint (Jira Software Cloud/Server)
      const response = await jiraApi.get(`/rest/agile/1.0/board/${boardId}/sprint`, {
        params: {
          state: 'future',
          maxResults: 10 // Limit to next 10 future sprints
        }
      });
      
      if (response.data && response.data.values) {
        futureSprints.push(...response.data.values.map(sprint => ({
          id: sprint.id,
          name: sprint.name,
          state: sprint.state,
          startDate: sprint.startDate ? new Date(sprint.startDate) : null,
          endDate: sprint.endDate ? new Date(sprint.endDate) : null,
          rapidViewId: boardId
        })));
      }
    } catch (error) {
      // If Agile API doesn't work, try GreenHopper API (older Jira versions)
      try {
        const response = await jiraApi.get(`/rest/greenhopper/1.0/sprintquery/${boardId}`, {
          params: {
            includeFutureSprints: true
          }
        });
        
        if (response.data && response.data.sprints) {
          const future = response.data.sprints.filter(s => s.state === 'future');
          futureSprints.push(...future.map(sprint => ({
            id: sprint.id,
            name: sprint.name,
            state: sprint.state,
            startDate: sprint.startDate ? new Date(sprint.startDate) : null,
            endDate: sprint.endDate ? new Date(sprint.endDate) : null,
            rapidViewId: boardId
          })));
        }
      } catch (ghError) {
        // Silently fail - board might not support future sprints or API might not be available
        console.log(`Could not fetch future sprints for board ${boardId}`);
      }
    }
  }
  
  return futureSprints;
}

/**
 * Get "In Progress" transition date
 * Tries multiple status name variations and also checks for partial matches
 */
function getInProgressDate(issue) {
  // First try exact matches with common variations
  const inProgressVariations = [
    'In Progress',
    'in progress',
    'IN PROGRESS',
    'InProgress',
    'In-Progress',
    'in-progress'
  ];
  
  for (const statusName of inProgressVariations) {
    const date = getStatusTransitionTime(issue, statusName);
    if (date) return date;
  }
  
  // If exact match fails, try to find any status transition that contains "progress"
  // This handles cases where the status name might be slightly different
  if (issue.changelog) {
    let histories = null;
    if (Array.isArray(issue.changelog.histories)) {
      histories = issue.changelog.histories;
    } else if (issue.changelog.histories && Array.isArray(issue.changelog.histories.values)) {
      histories = issue.changelog.histories.values;
    }
    
    if (histories && histories.length > 0) {
      const sortedHistories = [...histories].sort((a, b) => {
        const dateA = new Date(a.created || 0);
        const dateB = new Date(b.created || 0);
        return dateA - dateB;
      });
      
      for (const history of sortedHistories) {
        if (!history.items) continue;
        
        for (const item of history.items) {
          if (item.field === 'status' && item.toString) {
            const toStatus = item.toString.toLowerCase().trim();
            // Check if status name contains "progress" (case-insensitive)
            if (toStatus.includes('progress')) {
              return new Date(history.created);
            }
          }
        }
      }
    }
  }
  
  return null;
}

/**
 * Get "Ready for QA Release" transition date
 */
function getQAReadyDate(issue) {
  const qaReadyVariations = [
    'Ready for QA Release',
    'Ready for QA',
    'QA Ready',
    'Ready for Testing',
    'QA Release'
  ];
  
  for (const statusName of qaReadyVariations) {
    const date = getStatusTransitionTime(issue, statusName);
    if (date) return date;
  }
  
  return null;
}

/**
 * Optimized function to get issues for the issues page
 * - Adds date filtering to JQL query to reduce data fetched
 * - Fetches changelog only when needed (lazy loading)
 * - Uses caching for better performance
 */
async function getAllIssuesForPage(dateRange = null) {
  if (!JIRA_PAT || !JIRA_BASE_URL) {
    throw new Error('Jira credentials not configured. Please set JIRA_PAT and JIRA_BASE_URL environment variables.');
  }

  // Create cache key
  const cache = require('../utils/cache');
  const cacheKey = `issues-page:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ Issues page served from cache');
    return cached;
  }

  try {
    // Reuse the cached issues (specific to this date range if provided)
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
    // This ensures we only show issues where work began during the date range
    if (dateRange && dateRange.start) {
      const rangeStart = new Date(dateRange.start);
      filteredIssues = filteredIssues.filter(issue => {
        // If issue has an "In Progress" date, use that for filtering
        if (issue._inProgressDate) {
          const inProgressDate = new Date(issue._inProgressDate);
          return inProgressDate >= rangeStart;
        }
        // If no "In Progress" date, fall back to updated date (for issues that might not have gone through "In Progress")
        // This handles edge cases where issues were resolved without going to "In Progress"
        const updatedDate = issue.fields?.updated ? new Date(issue.fields.updated) : null;
        if (updatedDate) {
          return updatedDate >= rangeStart;
        }
        // If no dates at all, exclude it
        return false;
      });
    }
    
    // Cache page result for 2 minutes
    cache.set(cacheKey, filteredIssues, 120);
    return filteredIssues;
  } catch (error) {
    console.error('Error fetching issues page:', error.message);
    throw error;
  }
}

/**
 * Get all issues grouped by epic
 * Returns epics with their child issues and calculated metrics
 * 
 * Logic:
 * 1. Get user's issues filtered by date range
 * 2. Group those issues by epic key
 * 3. Calculate metrics ONLY from user's issues in the date range
 * 4. Only shows epics/projects the user worked on within the date range
 */
async function getProjectsByEpic(dateRange = null) {
  if (!JIRA_PAT || !JIRA_BASE_URL) {
    throw new Error('Jira credentials not configured. Please set JIRA_PAT and JIRA_BASE_URL environment variables.');
  }

  const cache = require('../utils/cache');
  const cacheKey = `projects-by-epic-v2:${JSON.stringify(dateRange)}`; // Changed cache key to force refresh
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ Projects by epic served from cache');
    return cached;
  }

  try {
    // Get current user info for identifying user's issues
    let currentUserAccountId = null;
    let currentUserEmail = null;
    try {
      const user = await getCurrentUser();
      currentUserAccountId = user.accountId;
      currentUserEmail = user.emailAddress;
    } catch (error) {
      // Silently fail - will try alternative methods
    }

    // Reuse cached issues
    const allIssues = await getAllIssues(dateRange);
    
    // Filter locally by date range (updated)
    // Use the fetched issues directly as they now contain all necessary fields
    let userIssuesInDateRange = allIssues;
    if (dateRange && (dateRange.start || dateRange.end)) {
      userIssuesInDateRange = allIssues.filter(issue => {
        const updated = new Date(issue.fields.updated);
        if (dateRange.start && updated < new Date(dateRange.start)) return false;
        if (dateRange.end && updated > new Date(dateRange.end)) return false;
        return true;
      });
    }

    // We skip the dynamic field discovery and rely on the robust exhaustive field list in getAllIssues
    // and the fallback methods in extractEpicKey (which check all fields)

    
    if (userIssuesInDateRange.length === 0) {
      return {
        epics: [],
        issuesWithoutEpic: 0,
        issuesWithoutEpicList: [],
        totalEpics: 0
      };
    }
    
    // Filter issues
    let filteredIssues = [...userIssuesInDateRange];
    
    // Exclude closed unassigned tickets (cancelled/no work needed)
    filteredIssues = filteredIssues.filter(issue => {
      const statusName = issue.fields?.status?.name || '';
      const isClosed = ['Done', 'Closed', 'Resolved'].includes(statusName);
      const isUnassigned = !issue.fields?.assignee;
      
      // Exclude closed unassigned tickets
      if (isClosed && isUnassigned) {
        return false;
      }
      
      return true;
    });
    
    // Use filtered issues instead of userIssuesInDateRange
    const userIssuesFiltered = filteredIssues;
    
    // Extract epic keys from user's issues using multiple methods
    const epicKeysSet = new Set();
    const issuesWithoutEpic = [];
    const userIssueKeys = new Set(userIssuesFiltered.map(i => i.key));
    
    const epicLinkFieldId = null; // Defined to satisfy legacy check
    // Helper to extract epic key from an issue
    function extractEpicKey(issue) {
      if (!issue || !issue.fields) return null;
      
      // Method 1: Check discovered Epic Link field (most reliable)
      if (epicLinkFieldId && issue.fields[epicLinkFieldId]) {
        const epicLinkValue = issue.fields[epicLinkFieldId];
        if (typeof epicLinkValue === 'string' && /^[A-Z]+-\d+$/.test(epicLinkValue)) {
          return epicLinkValue;
        }
        if (epicLinkValue && typeof epicLinkValue === 'object' && epicLinkValue.key) {
          return epicLinkValue.key;
        }
      }
      
      // Method 2: Check parent field (expanded)
      // Accept any parent - in Jira, parent could be Epic, Story, Feature, etc.
      // We'll resolve to the top-level epic later if needed
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
      
      // Method 3: Check epicLink field (standard field name)
      if (issue.fields.epicLink) {
        const epicLink = issue.fields.epicLink;
        if (typeof epicLink === 'string' && /^[A-Z]+-\d+$/.test(epicLink)) {
          return epicLink;
        }
        if (epicLink && typeof epicLink === 'object' && epicLink.key) {
          return epicLink.key;
        }
      }
      
      // Method 4: Check common epic link custom fields
      const epicLinkFields = [
        'customfield_10101', // Disney Jira epic link field
        'customfield_10011', 'customfield_10014', 'customfield_10015',
        'customfield_10008', 'customfield_10009', 'customfield_10010',
        'customfield_10007' // Common one
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
      
      // Method 5: Search all fields for epic-like references
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
    
    // Extract epic keys from user's issues (exclude Epic type issues - we only want child issues)
    for (const issue of userIssuesFiltered) {
      const issueType = issue.fields?.issuetype?.name;
      
      // Skip Epic type issues - we want epics the user has WORK in, not epics assigned to them
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
    
    // Alternative approach: Query epics that contain user's issue keys
    // This works by querying epics and checking which ones have issues matching user's issue keys
    if (epicKeysSet.size === 0 && userIssuesInDateRange.length > 0) {
      const projectKeys = [...new Set(userIssuesInDateRange.map(issue => issue.fields?.project?.key).filter(Boolean))];
      const userIssueKeys = userIssuesInDateRange.map(i => i.key);
      
      if (projectKeys.length > 0) {
        try {
          // Query for all epics in the projects
          const epicJql = `project IN (${projectKeys.join(', ')}) AND issuetype = Epic`;
          
          const epicResponse = await jiraApi.post('/rest/api/2/search', {
            jql: epicJql,
            maxResults: 1000,
            fields: ['key', 'summary', 'status', 'project']
          });
          
          if (epicResponse.data?.issues?.length > 0) {
            // For each epic, check if it contains any of the user's issues
            for (const epic of epicResponse.data.issues) {
              try {
                // Try different JQL patterns to find issues linked to this epic
                const jqlPatterns = [
                  `"Epic Link" = ${epic.key}`,
                  `"Epic Link" = "${epic.key}"`,
                  `parent = ${epic.key}`,
                  `"Parent" = ${epic.key}`,
                ];
                
                for (const jqlPattern of jqlPatterns) {
                  try {
                    const linkedIssuesResponse = await jiraApi.post('/rest/api/2/search', {
                      jql: jqlPattern,
                      maxResults: 1000,
                      fields: ['key']
                    });
                    
                    if (linkedIssuesResponse.data?.issues?.length > 0) {
                      const linkedIssueKeys = linkedIssuesResponse.data.issues.map(i => i.key);
                      const userIssuesInEpic = linkedIssueKeys.filter(key => userIssueKeys.includes(key));
                      
                      if (userIssuesInEpic.length > 0) {
                        epicKeysSet.add(epic.key);
                        break; // Found issues, move to next epic
                      }
        }
      } catch (error) {
                    // Try next pattern
                    continue;
                  }
                }
              } catch (error) {
                // Continue to next epic
              }
            }
          }
        } catch (error) {
          // Silently fail
        }
      }
    }
    
    const epicKeys = Array.from(epicKeysSet);
    
    // Helper function to format an issue
    function formatIssue(issue) {
      return {
        key: issue.key,
        summary: issue.fields?.summary,
        status: issue.fields?.status?.name,
        storyPoints: getStoryPoints(issue),
        created: issue.fields?.created,
        updated: issue.fields?.updated,
        resolved: issue.fields?.resolutiondate,
        assignee: issue.fields?.assignee?.displayName || 'Unassigned',
        isUserIssue: true
      };
    }
    
    // Format issues without epics (exclude User Stories and Epics)
    const formattedIssuesWithoutEpic = issuesWithoutEpic
      .filter(issue => {
        const issueType = issue.fields?.issuetype?.name;
        return issueType !== 'User Story' && issueType !== 'Epic';
      })
      .map(formatIssue);
    
    if (epicKeys.length === 0) {
      return {
        epics: [],
        issuesWithoutEpic: formattedIssuesWithoutEpic.length,
        issuesWithoutEpicList: formattedIssuesWithoutEpic,
        totalEpics: 0
      };
    }
    
    // Helper function to check if status is "Ready for QA Release" or later (completed)
    function isCompletedStatus(statusName) {
      const normalizedStatus = (statusName || '').toLowerCase();
      
      // Explicitly exclude In Progress and Code Review
      if (normalizedStatus.includes('in progress') || 
          normalizedStatus.includes('inprogress') ||
          normalizedStatus.includes('code review') ||
          normalizedStatus.includes('codereview') ||
          normalizedStatus.includes('review') && !normalizedStatus.includes('qa')) {
        return false;
      }
      
      const completedStatuses = [
        'ready for qa release',
        'ready for qa',
        'qa ready',
        'ready for testing',
        'qa release',
        'ready for prod',
        'ready for production',
        'ready for prod release',
        'prod ready',
        'done',
        'closed',
        'resolved'
      ];
      return completedStatuses.some(status => normalizedStatus.includes(status));
    }
    
    // Group user's date-filtered issues by epic (ONLY user's issues, no additional fetching)
    const issuesByEpic = {};
    for (const issue of userIssuesFiltered) {
      const issueType = issue.fields?.issuetype?.name;
      
      // Skip Epic type issues - only include actual work items
      if (issueType === 'Epic') {
        continue;
      }
      
      const epicKey = extractEpicKey(issue);
      if (epicKey && epicKeys.includes(epicKey)) {
        if (!issuesByEpic[epicKey]) {
          issuesByEpic[epicKey] = [];
        }
        issuesByEpic[epicKey].push(issue);
      }
    }
    
    const epicsData = [];
    
    for (const epicKey of epicKeys) {
      // Get user's issues for this epic (already filtered by date range)
      const epicIssues = issuesByEpic[epicKey] || [];
      
      // Filter out User Story type issues
      const issuesToCount = epicIssues.filter(issue => 
        issue.fields?.issuetype?.name !== 'User Story'
      );
      
      if (issuesToCount.length === 0) {
        continue;
      }
      
      // Fetch epic details for display
      let epicDetails = null;
      try {
        const epicResponse = await jiraApi.get(`/rest/api/2/issue/${epicKey}`, {
          params: {
            fields: 'summary,status,created,updated,resolutiondate,project,issuetype'
          }
        });
        epicDetails = epicResponse.data;
      } catch (error) {
        // Continue with limited epic info
      }
      
      // Fetch ALL issues in this epic (regardless of date range) for all-time metrics
      let allEpicIssues = [];
      
      // Try different JQL queries - some Jira instances use different field names
      const jqlAttempts = [
        `parent = ${epicKey}`,
        `"Parent Link" = ${epicKey}`,
        `"Epic Link" = ${epicKey}`
      ];
      
      // Add discovered epic link field if available
      if (epicLinkFieldId) {
        jqlAttempts.unshift(`cf[${epicLinkFieldId.replace('customfield_', '')}] = ${epicKey}`);
        jqlAttempts.unshift(`${epicLinkFieldId} = ${epicKey}`);
      }
      
      for (const jql of jqlAttempts) {
        try {
          const epicIssuesResponse = await jiraApi.post('/rest/api/2/search', {
            jql: `${jql} ORDER BY updated DESC`,
            maxResults: 500,
            fields: ['key', 'summary', 'status', 'assignee', 'issuetype',
              'customfield_10106', 'customfield_21766', 'customfield_10016', 
              'customfield_10021', 'customfield_10002', 'customfield_10004',
              'timeoriginalestimate']
          });
          const issues = epicIssuesResponse.data?.issues || [];
          if (issues.length > 0) {
            // Count issue types BEFORE filtering (for breakdown display)
            const issueTypeCounts = {};
            issues.forEach(issue => {
              const typeName = issue.fields?.issuetype?.name || 'Unknown';
              issueTypeCounts[typeName] = (issueTypeCounts[typeName] || 0) + 1;
            });
            
            // Store the breakdown, then filter out User Stories for metrics
            allEpicIssues = issues.filter(issue => issue.fields?.issuetype?.name !== 'User Story');
            allEpicIssues._issueTypeCounts = issueTypeCounts;
            break;
          }
        } catch (error) {
          // Try next JQL pattern
        }
      }
      
      // Get issue type breakdown (before User Story filtering)
      const issueTypeBreakdown = allEpicIssues._issueTypeCounts || {};
      
      // Calculate all-time epic metrics
      let epicTotalPoints = 0;
      let userTotalPointsAllTime = 0;
      let userTotalIssuesAllTime = 0;
      
      allEpicIssues.forEach(issue => {
        const points = getStoryPoints(issue);
        epicTotalPoints += points;
        
        // Check if this is the user's issue
        const assigneeId = issue.fields?.assignee?.accountId;
        const assigneeEmail = issue.fields?.assignee?.emailAddress;
        
        // Match by accountId OR email (case-insensitive)
        const isCurrentUser = (currentUserAccountId && assigneeId === currentUserAccountId) || 
            (currentUserEmail && assigneeEmail && assigneeEmail.toLowerCase() === currentUserEmail.toLowerCase());
        
        if (isCurrentUser) {
          userTotalPointsAllTime += points;
          userTotalIssuesAllTime++;
        }
      });
      
      // Calculate metrics from user's issues ONLY (date-filtered)
      let totalStoryPoints = 0;
      let remainingStoryPoints = 0;
      let storyPointsCompleted = 0;
      let doneIssues = 0;
      let mostRecentUpdate = null;
      
      issuesToCount.forEach(issue => {
        const points = getStoryPoints(issue);
        const statusName = issue.fields?.status?.name || '';
        const isCompleted = isCompletedStatus(statusName);
        
        totalStoryPoints += points;
        
        if (isCompleted) {
          storyPointsCompleted += points;
          doneIssues++;
        } else {
          remainingStoryPoints += points;
        }
        
        const updatedDate = issue.fields?.updated ? new Date(issue.fields.updated) : null;
        if (updatedDate && (!mostRecentUpdate || updatedDate > mostRecentUpdate)) {
          mostRecentUpdate = updatedDate;
        }
      });
      
      // Determine simplified epic status based on user's issues
      let simplifiedStatus = 'TO DO';
      const allUserIssuesDone = issuesToCount.every(issue => 
        isCompletedStatus(issue.fields?.status?.name || '')
      );
      const hasInProgressIssues = issuesToCount.some(issue => {
        const statusName = issue.fields?.status?.name || '';
        return !['Done', 'Closed', 'Resolved', 'To Do', 'Open', 'Backlog'].includes(statusName);
      });
      
      if (allUserIssuesDone) {
        simplifiedStatus = 'DONE';
      } else if (hasInProgressIssues) {
        simplifiedStatus = 'IN PROGRESS';
      }
      
      // Build formatted issues list
      const issuesList = issuesToCount.map(formatIssue);
      
      epicsData.push({
        epicKey: epicKey,
        epicName: epicDetails?.fields?.summary || `Epic ${epicKey}`,
        epicStatus: simplifiedStatus,
        epicCreated: epicDetails?.fields?.created,
        epicUpdated: epicDetails?.fields?.updated,
        epicResolved: epicDetails?.fields?.resolutiondate,
        project: epicDetails?.fields?.project?.key || issuesToCount[0]?.fields?.project?.key || 'Unknown',
        projectName: epicDetails?.fields?.project?.name || issuesToCount[0]?.fields?.project?.name || 'Unknown',
        issues: issuesList,
        mostRecentUserUpdate: mostRecentUpdate ? mostRecentUpdate.toISOString() : null,
        issueTypeBreakdown: issueTypeBreakdown,
        metrics: {
          totalIssues: issuesToCount.length,
          totalDoneIssues: doneIssues,
          totalStoryPoints,
          remainingStoryPoints,
          storyPointsCompleted,
          completionPercentage: issuesToCount.length > 0 
            ? Math.round((doneIssues / issuesToCount.length) * 100) 
            : 0,
          // All-time metrics (regardless of date range)
          epicTotalPoints,
          userTotalPointsAllTime,
          userTotalIssuesAllTime,
          epicTotalIssues: allEpicIssues.length
        }
      });
    }

    // Sort by most recent user update (most recent first), then by epic name
    epicsData.sort((a, b) => {
      const dateA = a.mostRecentUserUpdate ? new Date(a.mostRecentUserUpdate) : new Date(0);
      const dateB = b.mostRecentUserUpdate ? new Date(b.mostRecentUserUpdate) : new Date(0);
      
      // Sort by date descending (most recent first)
      if (dateB.getTime() !== dateA.getTime()) {
        return dateB - dateA;
      }
      
      // If dates are equal (or both null), sort by name
      return a.epicName.localeCompare(b.epicName);
    });

    const result = {
      epics: epicsData,
      issuesWithoutEpic: issuesWithoutEpic.length,
      issuesWithoutEpicList: formattedIssuesWithoutEpic,
      totalEpics: epicsData.length
    };

    cache.set(cacheKey, result, 300); // Cache for 5 minutes
    return result;
  } catch (error) {
    console.error('Error fetching projects by epic:', error);
    throw error;
  }
}

module.exports = {
  getStats,
  getAllIssuesForPage,
  getProjectsByEpic
};

