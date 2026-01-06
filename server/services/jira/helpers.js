/**
 * Get story points from an issue
 */
function getStoryPoints(issue) {
  const storyPointFields = [
    'customfield_10106', // Disney Jira story points
    'customfield_21766', // Disney Jira story points
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

module.exports = {
  getStoryPoints,
  getStatusTransitionTime
};

