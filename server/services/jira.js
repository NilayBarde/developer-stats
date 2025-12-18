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
  const issues = [];
  let startAt = 0;
  const maxResults = 100;
  let hasMore = true;
  
  // Get current user info first to use their accountId or email
  let userAccountId = null;
  let userEmail = null;
  try {
    const user = await getCurrentUser();
    userAccountId = user.accountId;
    userEmail = user.emailAddress;
  } catch (error) {
    // Silently fail - will try alternative JQL queries
  }

  // Don't filter by date in JQL - we want ALL issues to capture all sprints
  // Sprint date filtering happens later in calculateVelocity based on sprint dates
  // This ensures sprints from before the date range are included if they overlap
  let dateFilter = '';

  // Try different JQL queries - API tokens may restrict currentUser() even if web UI allows it
  const baseQueries = [
    `assignee = currentUser()`, // Try currentUser() first
    userEmail ? `assignee = "${userEmail}"` : null, // Fallback to email
    userAccountId ? `assignee = ${userAccountId}` : null // Try accountId if available
  ].filter(Boolean);
  
  const jqlQueries = baseQueries.map(base => `${base} ORDER BY created DESC`);

  // Only fetch fields we actually need to reduce payload size
  const requiredFields = [
    'key', 'summary', 'status', 'created', 'updated', 'resolutiondate',
    'issuetype', 'project', 'timespent', 'timeoriginalestimate',
    'customfield_10105', 'customfield_10020', 'customfield_10007', 'customfield_10000', // Sprint fields
    'customfield_10106', 'customfield_21766', 'customfield_10016', 'customfield_10021', // Story point fields
    'customfield_10002', 'customfield_10004', 'customfield_10020'
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
        expand: ['names']
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
  

  // Process each board separately
  const boardResults = {};
  let allSprintVelocities = [];
  
  for (const [boardName, sprints] of Object.entries(sprintsByBoard)) {
    let sprintArray = Object.values(sprints).sort((a, b) => {
      const dateA = a.endDate || a.startDate;
      const dateB = b.endDate || b.startDate;
      return dateA - dateB;
    });
    
    // Filter sprints by date range if provided (based on sprint dates, not issue resolution dates)
    if (dateRange) {
      const { getDateRange, isInDateRange } = require('../utils/dateHelpers');
      const range = getDateRange(dateRange);
      
      sprintArray = sprintArray.filter(sprint => {
        // Include sprint if it overlaps with date range
        // Check if sprint start or end date falls within range, or if sprint spans the range
        if (range.start === null && range.end === null) return true;
        
        const sprintStart = sprint.startDate ? new Date(sprint.startDate) : null;
        const sprintEnd = sprint.endDate ? new Date(sprint.endDate) : null;
        
        if (!sprintStart && !sprintEnd) return false;
        
        // Sprint overlaps if:
        // - Sprint starts before range ends AND sprint ends after range starts
        // - Or sprint start/end is within range
        if (range.start && range.end) {
          const rangeStart = new Date(range.start);
          rangeStart.setHours(0, 0, 0, 0);
          const rangeEnd = new Date(range.end);
          rangeEnd.setHours(23, 59, 59, 999);
          if (sprintStart && sprintEnd) {
            // Sprint overlaps if it starts before range ends AND ends after range starts
            return sprintStart <= rangeEnd && sprintEnd >= rangeStart;
          }
          if (sprintStart) return sprintStart <= rangeEnd && sprintStart >= rangeStart;
          if (sprintEnd) return sprintEnd >= rangeStart && sprintEnd <= rangeEnd;
        } else if (range.start) {
          // Only start date specified (present) - include sprints that end on or after start date
          const rangeStart = new Date(range.start);
          rangeStart.setHours(0, 0, 0, 0);
          if (sprintEnd) return sprintEnd >= rangeStart;
          if (sprintStart) return sprintStart >= rangeStart;
        } else if (range.end) {
          // Only end date specified - include sprints that start before or on end date
          const rangeEnd = new Date(range.end);
          rangeEnd.setHours(23, 59, 59, 999);
          if (sprintStart) return sprintStart <= rangeEnd;
          if (sprintEnd) return sprintEnd <= rangeEnd;
        }
        
        return false;
      });
    }
    
    // Calculate average velocity from sprints with points > 0
    const velocities = sprintArray
      .filter(sprint => sprint.points > 0)
      .map(sprint => sprint.points);
    const avgVelocity = velocities.length > 0 
      ? velocities.reduce((a, b) => a + b, 0) / velocities.length 
      : 0;

    allSprintVelocities.push(...velocities);
    
    boardResults[boardName] = {
      sprints: sprintArray, // Show all sprints including those with 0 points
      averageVelocity: Math.round(avgVelocity * 10) / 10,
      totalSprints: sprintArray.length
    };
  }

  // Calculate combined average velocity (weighted by number of sprints per board)
  let combinedAvgVelocity = 0;
  if (Object.keys(boardResults).length > 0) {
    const boardAverages = Object.values(boardResults)
      .filter(board => board.totalSprints > 0)
      .map(board => ({
        avg: board.averageVelocity,
        weight: board.totalSprints
      }));
    
    if (boardAverages.length > 0) {
      const totalWeight = boardAverages.reduce((sum, b) => sum + b.weight, 0);
      const weightedSum = boardAverages.reduce((sum, b) => sum + (b.avg * b.weight), 0);
      combinedAvgVelocity = totalWeight > 0 
        ? Math.round((weightedSum / totalWeight) * 10) / 10
        : 0;
    }
  }

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

function calculateStats(issues, dateRange = null) {
  const now = new Date();
  
  // Filter issues by date range
  const filteredIssues = dateRange 
    ? filterByDateRange(issues, 'fields.created', dateRange)
    : issues;

  // Basic stats
  const timePeriodStats = calculateTimePeriodStats(filteredIssues, 'fields.created');
  
  const resolved = filteredIssues.filter(issue => issue.fields.resolutiondate).length;
  const inProgress = filteredIssues.filter(issue => 
    issue.fields.status.name !== 'Done' && 
    issue.fields.status.name !== 'Closed'
  ).length;
  const done = filteredIssues.filter(issue => 
    issue.fields.status.name === 'Done' || 
    issue.fields.status.name === 'Closed'
  ).length;

  // Calculate average resolution time
  const resolvedIssues = filteredIssues.filter(issue => issue.fields.resolutiondate);
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

  // Calculate velocity
  const velocity = calculateVelocity(filteredIssues, dateRange);

  // Monthly stats
  const monthlyIssues = calculateMonthlyStats(filteredIssues, 'fields.created', dateRange);

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
    avgResolutionTime: Math.round(avgResolutionTime * 10) / 10,
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

  try {
    const issues = await getAllIssues(dateRange);
    const stats = calculateStats(issues, dateRange);
    
    let userEmail = null;
    try {
      const user = await getCurrentUser();
      userEmail = user.emailAddress;
    } catch (error) {
      // User fetch failed, but we can still return stats
    }
    
    return {
      ...stats,
      source: 'jira',
      email: userEmail,
      baseUrl: normalizedBaseURL
    };
  } catch (error) {
    console.error('❌ Error fetching Jira stats:', error.message);
    throw error;
  }
}

module.exports = {
  getStats
};

