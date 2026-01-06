/**
 * JIRA Sprints - Sprint parsing and extraction utilities
 */

/**
 * Parse sprint string from Jira's internal format
 * Example: "com.atlassian.greenhopper.service.sprint.Sprint@...[id=123,name=Sprint 1,...]"
 * @param {string} sprintString - Raw sprint string from JIRA
 * @returns {Object|null} Parsed sprint data
 */
function parseSprintString(sprintString) {
  const match = sprintString.match(/\[(.*)\]/);
  if (!match) return null;
  
  const content = match[1];
  const sprintData = {};
  
  const pairs = content.split(',').map(p => p.trim());
  pairs.forEach(pair => {
    const [key, ...valueParts] = pair.split('=');
    if (key && valueParts.length > 0) {
      let value = valueParts.join('=');
      if (value === '<null>') {
        value = null;
      } else if (value && !isNaN(value) && value !== '') {
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

/**
 * Extract sprint info from sprint field
 * @param {any} sprintField - Sprint field value (can be array, object, or string)
 * @param {Date|null} resolvedDate - Issue resolution date
 * @param {string|null} issueKey - Issue key for logging
 * @returns {Object|null} Normalized sprint info
 */
function extractSprintInfo(sprintField, resolvedDate, issueKey = null) {
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
  let selectedSprint = null;
  
  if (sprints.length === 1) {
    selectedSprint = sprints[0];
  } else {
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
        if (!a.startDate && !b.startDate) return 0;
        if (!a.startDate) return 1;
        if (!b.startDate) return -1;
        return a.startDate - b.startDate;
      });
    
    if (sprintsWithDates.length > 0) {
      selectedSprint = sprintsWithDates[0].sprint;
    } else {
      selectedSprint = sprints[0];
    }
  }
  
  // Sprint can be an object with id, name, state, etc.
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
  
  // If it's just a string/ID
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

/**
 * Find sprint field in issue (tries multiple possible field IDs)
 * @param {Object} issue - JIRA issue object
 * @returns {any|null} Sprint field value
 */
function findSprintField(issue) {
  const sprintFieldIds = [
    'customfield_10020', // Most common
    'customfield_10105',
    'customfield_10100',
    'customfield_10001',
    'customfield_10005',
    'customfield_10017',
    'customfield_10200',
    'customfield_10201',
    'customfield_10202',
    'customfield_10104',
    'sprint'
  ];
  
  for (const fieldId of sprintFieldIds) {
    const value = issue.fields?.[fieldId];
    if (value !== undefined && value !== null) {
      // Validate it looks like sprint data
      if (Array.isArray(value) && value.length > 0) {
        return value;
      }
      if (typeof value === 'object' && (value.id || value.name)) {
        return value;
      }
      if (typeof value === 'string' && value.includes('sprint')) {
        return value;
      }
    }
  }
  
  return null;
}

/**
 * Get board name from sprint name or rapidViewId
 * @param {string} sprintName - Sprint name
 * @param {number|null} rapidViewId - Board/rapid view ID
 * @returns {string|null} Board name
 */
function getBoardName(sprintName, rapidViewId) {
  // Try to extract board name from sprint name pattern
  // Common patterns: "Board Name Sprint X", "Team Name - Sprint X"
  if (sprintName) {
    const patterns = [
      /^(.+?)\s*-?\s*Sprint\s*\d+$/i,
      /^(.+?)\s+Sprint\s*\d+$/i,
      /^(.+?)\s*Sprint$/i
    ];
    
    for (const pattern of patterns) {
      const match = sprintName.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
  }
  
  // Use rapidViewId as fallback identifier
  if (rapidViewId) {
    return `Board ${rapidViewId}`;
  }
  
  return null;
}

/**
 * Get all sprints from an issue (for issues in multiple sprints)
 * @param {Object} issue - JIRA issue object
 * @returns {Array} Array of sprint info objects
 */
function getAllSprints(issue) {
  const sprintField = findSprintField(issue);
  if (!sprintField) return [];
  
  const sprints = Array.isArray(sprintField) ? sprintField : [sprintField];
  const result = [];
  
  for (const sprint of sprints) {
    if (typeof sprint === 'string' && sprint.includes('com.atlassian.greenhopper.service.sprint.Sprint')) {
      const parsed = parseSprintString(sprint);
      if (parsed) {
        result.push({
          id: parsed.id,
          name: parsed.name || `Sprint ${parsed.id}`,
          state: parsed.state,
          startDate: parsed.startDate ? new Date(parsed.startDate) : null,
          endDate: parsed.endDate ? new Date(parsed.endDate) : null,
          completeDate: parsed.completeDate ? new Date(parsed.completeDate) : null,
          rapidViewId: parsed.rapidViewId
        });
      }
    } else if (typeof sprint === 'object' && sprint !== null) {
      result.push({
        id: sprint.id || sprint.sprintId,
        name: sprint.name || sprint.value || `Sprint ${sprint.id}`,
        state: sprint.state,
        startDate: sprint.startDate ? new Date(sprint.startDate) : null,
        endDate: sprint.endDate ? new Date(sprint.endDate) : null,
        completeDate: sprint.completeDate ? new Date(sprint.completeDate) : null,
        rapidViewId: sprint.rapidViewId,
        boardId: sprint.boardId
      });
    }
  }
  
  return result;
}

/**
 * Get best sprint for issue (first by start date)
 * @param {Object} issue - JIRA issue object
 * @returns {Object|null} Best sprint info
 */
function getBestSprintForIssue(issue) {
  const sprintField = findSprintField(issue);
  return extractSprintInfo(sprintField, issue.fields?.resolutiondate ? new Date(issue.fields.resolutiondate) : null, issue.key);
}

/**
 * Get sprint name from issue
 * @param {Object} issue - JIRA issue object
 * @returns {string|null} Sprint name
 */
function getSprintName(issue) {
  const sprint = getBestSprintForIssue(issue);
  return sprint?.name || null;
}

/**
 * Get unique board IDs from issues
 * @param {Array} issues - Array of JIRA issues
 * @returns {Array<number>} Unique board IDs
 */
function getBoardIdsFromIssues(issues) {
  const boardIds = new Set();
  
  for (const issue of issues) {
    const sprints = getAllSprints(issue);
    for (const sprint of sprints) {
      if (sprint.rapidViewId) {
        boardIds.add(sprint.rapidViewId);
      }
      if (sprint.boardId) {
        boardIds.add(sprint.boardId);
      }
    }
  }
  
  return Array.from(boardIds);
}

module.exports = {
  parseSprintString,
  extractSprintInfo,
  findSprintField,
  getBoardName,
  getAllSprints,
  getBestSprintForIssue,
  getSprintName,
  getBoardIdsFromIssues
};
