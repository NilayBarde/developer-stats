/**
 * Helper functions for Jira issues
 */

/**
 * Get story points from an issue
 */
export function getStoryPoints(issue) {
  const points = issue.fields?.customfield_10016 || issue.fields?.customfield_10020;
  return points ? parseFloat(points) : 0;
}

/**
 * Get sprint name from issue
 */
export function getSprintName(issue) {
  return issue._sprintName || '-';
}

/**
 * Get status name from issue
 */
export function getStatusName(issue) {
  return issue.fields?.status?.name || 'Unknown';
}

/**
 * Get project key from issue
 */
export function getProjectKey(issue) {
  return issue.fields?.project?.key || 'N/A';
}

/**
 * Get issue type from issue
 */
export function getIssueType(issue) {
  return issue.fields?.issuetype?.name || 'N/A';
}

