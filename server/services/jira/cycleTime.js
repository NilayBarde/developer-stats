/**
 * JIRA Cycle Time - Calculations for issue cycle time and priority breakdown
 */

/**
 * Get status transition time from changelog
 * Returns the date when status changed to the target status, or null if not found
 * @param {Object} issue - JIRA issue object
 * @param {string} targetStatusName - Status name to find transition to
 * @returns {Date|null}
 */
function getStatusTransitionTime(issue, targetStatusName) {
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

  const normalizedTarget = targetStatusName.toLowerCase().trim();
  
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
 * @param {Object} issue - JIRA issue object
 * @returns {number|null} Days or null
 */
function calculateInProgressToQAReadyTime(issue) {
  const inProgressVariations = [
    'In Progress',
    'in progress',
    'IN PROGRESS',
    'InProgress'
  ];
  
  const qaReadyVariations = [
    'Ready for QA Release',
    'Ready for QA',
    'QA Ready',
    'Ready for Testing',
    'QA Release'
  ];
  
  let inProgressTime = null;
  for (const statusName of inProgressVariations) {
    inProgressTime = getStatusTransitionTime(issue, statusName);
    if (inProgressTime) break;
  }
  
  if (!inProgressTime) {
    return null;
  }
  
  let qaReadyTime = null;
  for (const statusName of qaReadyVariations) {
    qaReadyTime = getStatusTransitionTime(issue, statusName);
    if (qaReadyTime) break;
  }
  
  // Fallback to resolution date
  if (!qaReadyTime && issue.fields?.resolutiondate) {
    qaReadyTime = new Date(issue.fields.resolutiondate);
  }
  
  if (!qaReadyTime) {
    return null;
  }
  
  if (qaReadyTime < inProgressTime) {
    return null;
  }
  
  return (qaReadyTime - inProgressTime) / (1000 * 60 * 60 * 24);
}

/**
 * Calculate cycle time from created to resolved (matches engineering-metrics)
 * Returns time in days, or null if not resolved
 * @param {Object} issue - JIRA issue object
 * @returns {number|null} Days or null
 */
function calculateCreatedToResolvedTime(issue) {
  const created = issue.fields?.created;
  const resolved = issue.fields?.resolutiondate;
  
  if (!created || !resolved) {
    return null;
  }
  
  const createdDate = new Date(created);
  const resolvedDate = new Date(resolved);
  
  if (resolvedDate < createdDate) {
    return null;
  }
  
  return (resolvedDate - createdDate) / (1000 * 60 * 60 * 24);
}

/**
 * Get priority level from issue (P1, P2, P3, P4)
 * @param {Object} issue - JIRA issue object
 * @returns {string} Priority like "P1", "P2", etc.
 */
function getIssuePriority(issue) {
  const priority = issue.fields?.priority?.name || '';
  
  // Map various priority names to P1-P4
  const priorityMap = {
    'highest': 'P1',
    'blocker': 'P1',
    'critical': 'P1',
    'p1': 'P1',
    'high': 'P2',
    'p2': 'P2',
    'medium': 'P3',
    'normal': 'P3',
    'p3': 'P3',
    'low': 'P4',
    'lowest': 'P4',
    'minor': 'P4',
    'trivial': 'P4',
    'p4': 'P4'
  };
  
  const normalized = priority.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  // Check for P1, P2, etc. in the name
  const pMatch = normalized.match(/p([1-4])/);
  if (pMatch) {
    return `P${pMatch[1]}`;
  }
  
  return priorityMap[normalized] || 'P3';
}

/**
 * Calculate cycle time breakdown by priority
 * @param {Array} issues - Array of JIRA issues
 * @returns {Object} Cycle time stats by priority
 */
function calculateCycleTimeByPriority(issues) {
  const byPriority = {
    P1: { total: 0, count: 0, avg: null },
    P2: { total: 0, count: 0, avg: null },
    P3: { total: 0, count: 0, avg: null },
    P4: { total: 0, count: 0, avg: null }
  };
  
  let overallTotal = 0;
  let overallCount = 0;
  
  for (const issue of issues) {
    const cycleTime = calculateCreatedToResolvedTime(issue);
    if (cycleTime === null) continue;
    
    const priority = getIssuePriority(issue);
    
    if (byPriority[priority]) {
      byPriority[priority].total += cycleTime;
      byPriority[priority].count++;
    }
    
    overallTotal += cycleTime;
    overallCount++;
  }
  
  // Calculate averages
  for (const priority of Object.keys(byPriority)) {
    if (byPriority[priority].count > 0) {
      byPriority[priority].avg = Math.round((byPriority[priority].total / byPriority[priority].count) * 10) / 10;
    }
  }
  
  const overallAvg = overallCount > 0 
    ? Math.round((overallTotal / overallCount) * 10) / 10 
    : null;
  
  return {
    byPriority,
    overall: overallAvg,
    counts: {
      P1: byPriority.P1.count,
      P2: byPriority.P2.count,
      P3: byPriority.P3.count,
      P4: byPriority.P4.count,
      total: overallCount
    }
  };
}

/**
 * Get the "In Progress" date from issue changelog
 * @param {Object} issue - JIRA issue object
 * @returns {Date|null}
 */
function getInProgressDate(issue) {
  const inProgressVariations = [
    'In Progress',
    'in progress',
    'IN PROGRESS'
  ];
  
  for (const statusName of inProgressVariations) {
    const date = getStatusTransitionTime(issue, statusName);
    if (date) return date;
  }
  
  return null;
}

/**
 * Get the "QA Ready" date from issue changelog
 * @param {Object} issue - JIRA issue object
 * @returns {Date|null}
 */
function getQAReadyDate(issue) {
  const qaReadyVariations = [
    'Ready for QA Release',
    'Ready for QA',
    'QA Ready',
    'Ready for Testing'
  ];
  
  for (const statusName of qaReadyVariations) {
    const date = getStatusTransitionTime(issue, statusName);
    if (date) return date;
  }
  
  return null;
}

module.exports = {
  getStatusTransitionTime,
  calculateInProgressToQAReadyTime,
  calculateCreatedToResolvedTime,
  getIssuePriority,
  calculateCycleTimeByPriority,
  getInProgressDate,
  getQAReadyDate
};
