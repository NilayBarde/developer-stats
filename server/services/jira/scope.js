/**
 * JIRA Scope - ESPN Web scope checking and untracked issue detection
 * Matches engineering-metrics project filter logic
 */

/**
 * Check if an issue is in ESPN Web scope (tracked by engineering-metrics)
 * 
 * Scope rules:
 * - SEWEB: requires SPORTSWEB/Sportsweb/sportsweb label
 * - CTOI: requires Root Cause = "Code Defect - Client Code - Web"
 * - EFP/EFAE/EFWatch: requires "ESPN Web" component
 * 
 * @param {Object} issue - JIRA issue object
 * @returns {Object} { inScope: boolean, reason: string|null }
 */
function isInESPNWebScope(issue) {
  const project = issue.fields?.project?.key || '';
  const labels = issue.fields?.labels || [];
  const rootCause = issue.fields?.customfield_10207 || issue.fields?.['Root Cause'] || '';
  const components = (issue.fields?.components || []).map(c => c.name);
  
  // SEWEB with SPORTSWEB label
  if (project === 'SEWEB') {
    const hasSportswebLabel = labels.some(l => 
      l.toLowerCase() === 'sportsweb' || l.toLowerCase() === 'sports-web'
    );
    if (hasSportswebLabel) {
      return { inScope: true, reason: null };
    }
    return { inScope: false, reason: 'Missing SPORTSWEB label' };
  }
  
  // CTOI with Web root cause
  if (project === 'CTOI') {
    // Extract the actual root cause value (could be string or object with value property)
    const actualRootCause = typeof rootCause === 'object' ? rootCause?.value : rootCause;
    const isWebRootCause = actualRootCause === 'Code Defect - Client Code - Web';
    if (isWebRootCause) {
      return { inScope: true, reason: null };
    }
    // Show what the current root cause is so user knows what to change
    const currentValue = actualRootCause || '(not set)';
    return { 
      inScope: false, 
      reason: `Root Cause is "${currentValue}" → needs "Code Defect - Client Code - Web"` 
    };
  }
  
  // ESPN Flagship Paywall/App Experience with ESPN Web component
  if (project === 'EFP' || project === 'EFAE' || project === 'EFWatch') {
    const hasWebComponent = components.includes('ESPN Web');
    if (hasWebComponent) {
      return { inScope: true, reason: null };
    }
    return { inScope: false, reason: 'Missing "ESPN Web" component' };
  }
  
  // Other projects not in scope
  return { inScope: false, reason: `Project "${project}" not in ESPN Web scope` };
}

/**
 * Get story points from issue (tries multiple custom field IDs)
 * @param {Object} issue - JIRA issue object
 * @returns {number} Story points (0 if not found)
 */
function getStoryPoints(issue) {
  // Try multiple common story point field IDs
  // Different Jira instances use different custom field IDs
  const storyPointFields = [
    'customfield_10106', // Disney Jira story points
    'customfield_21766', // Disney Jira story points
    'customfield_10016', // Common in Jira Cloud
    'customfield_10021', // Another common one
    'customfield_10002', // Sometimes used
    'customfield_10004', // Sometimes used
    'customfield_10020', // Can be story points
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
 * Categorize issues by ESPN Web scope
 * @param {Array} issues - Array of JIRA issues
 * @returns {Object} { tracked: Array, untracked: Array }
 */
function categorizeByScope(issues) {
  const tracked = [];
  const untracked = [];
  
  for (const issue of issues) {
    const scopeCheck = isInESPNWebScope(issue);
    if (scopeCheck.inScope) {
      tracked.push(issue);
    } else {
      untracked.push({
        issue,
        reason: scopeCheck.reason
      });
    }
  }
  
  return { tracked, untracked };
}

/**
 * Build untracked issue info for UI display
 * @param {Object} issue - JIRA issue object
 * @param {number} points - Story points
 * @param {string} reason - Reason for being untracked
 * @returns {Object} Untracked issue info
 */
function buildUntrackedInfo(issue, points, reason) {
  return {
    key: issue.key,
    summary: issue.fields?.summary || '',
    project: issue.fields?.project?.key || '',
    points: points,
    reason: reason,
    url: `https://jira.disney.com/browse/${issue.key}`
  };
}

module.exports = {
  isInESPNWebScope,
  getStoryPoints,
  categorizeByScope,
  buildUntrackedInfo
};
