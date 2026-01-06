/**
 * JIRA Velocity - Velocity calculations (engineering-metrics style)
 * Groups by resolution month, calculates approx velocity = points / 2
 */

const { format } = require('date-fns');
const { isInESPNWebScope, getStoryPoints } = require('./scope');

/**
 * Calculate velocity grouped by month (engineering-metrics style)
 * @param {Array} issues - Array of JIRA issues
 * @param {Object|null} dateRange - Optional date range filter { start, end }
 * @returns {Object} Velocity stats with monthly breakdown
 */
function calculateVelocity(issues, dateRange = null) {
  // Only count resolved issues
  const resolvedIssues = issues.filter(issue => {
    const status = issue.fields?.status?.name?.toLowerCase() || '';
    const hasResolution = !!issue.fields?.resolutiondate;
    return hasResolution || status === 'done' || status === 'closed';
  });
  
  // Track issues not in ESPN Web scope (for user awareness)
  const untrackedByMonth = {};
  
  // Group resolved issues by month (using resolution date)
  const monthlyPoints = {};
  const monthlyIssues = {};
  const monthlyIssueKeys = {};
  
  resolvedIssues.forEach(issue => {
    const dateStr = issue.fields?.resolutiondate || issue.fields?.updated;
    if (!dateStr) return;
    
    const date = new Date(dateStr);
    const monthKey = format(date, 'yyyy-MM');
    const storyPoints = getStoryPoints(issue);
    
    if (!monthlyPoints[monthKey]) {
      monthlyPoints[monthKey] = 0;
      monthlyIssues[monthKey] = 0;
      monthlyIssueKeys[monthKey] = [];
    }
    
    monthlyPoints[monthKey] += storyPoints;
    monthlyIssues[monthKey] += 1;
    if (issue.key) {
      monthlyIssueKeys[monthKey].push(issue.key);
    }
    
    // Track issues not in ESPN Web scope
    const scopeCheck = isInESPNWebScope(issue);
    if (!scopeCheck.inScope) {
      if (!untrackedByMonth[monthKey]) {
        untrackedByMonth[monthKey] = [];
      }
      untrackedByMonth[monthKey].push({
        key: issue.key,
        summary: issue.fields?.summary || '',
        project: issue.fields?.project?.key || '',
        points: storyPoints,
        reason: scopeCheck.reason,
        url: `https://jira.disney.com/browse/${issue.key}`
      });
    }
  });
  
  // Filter by date range if provided
  let filteredMonths = Object.keys(monthlyPoints);
  if (dateRange) {
    const { getDateRange } = require('../../utils/dateHelpers');
    const range = getDateRange(dateRange);
    
    if (range.start || range.end) {
      filteredMonths = filteredMonths.filter(monthKey => {
        const monthDate = new Date(monthKey + '-01');
        const monthEnd = new Date(monthDate);
        monthEnd.setMonth(monthEnd.getMonth() + 1);
        monthEnd.setDate(0);
        
        if (range.start && range.end) {
          const rangeStart = new Date(range.start);
          const rangeEnd = new Date(range.end);
          return monthDate <= rangeEnd && monthEnd >= rangeStart;
        } else if (range.start) {
          return monthEnd >= new Date(range.start);
        } else if (range.end) {
          return monthDate <= new Date(range.end);
        }
        return true;
      });
    }
  }
  
  // Sort months chronologically
  filteredMonths.sort();
  
  // Build monthly velocity data
  const monthlyVelocityData = filteredMonths.map(monthKey => {
    const points = monthlyPoints[monthKey] || 0;
    // Engineering-metrics style: approx velocity = points / 2 (assumes 2 sprints/month)
    const approxVelocity = Math.round((points / 2) * 10) / 10;
    
    const [year, month] = monthKey.split('-');
    const monthDate = new Date(parseInt(year), parseInt(month) - 1, 1);
    const monthName = format(monthDate, 'MMM yyyy');
    
    const untracked = untrackedByMonth[monthKey] || [];
    const untrackedPoints = untracked.reduce((sum, i) => sum + (i.points || 0), 0);
    
    return {
      id: monthKey,
      name: monthName,
      month: monthKey,
      points: points,
      approxVelocity: approxVelocity,
      issues: monthlyIssues[monthKey] || 0,
      issueKeys: monthlyIssueKeys[monthKey] || [],
      // Issues not tracked by engineering-metrics (outside ESPN Web scope)
      untracked: untracked,
      untrackedCount: untracked.length,
      untrackedPoints: untrackedPoints,
      // For chart compatibility
      startDate: new Date(parseInt(year), parseInt(month) - 1, 1),
      endDate: new Date(parseInt(year), parseInt(month), 0)
    };
  });
  
  // Calculate overall average velocity
  const totalPoints = filteredMonths.reduce((sum, m) => sum + (monthlyPoints[m] || 0), 0);
  const totalMonths = filteredMonths.length;
  
  // Average velocity per sprint = (total points / total months) / 2
  const avgVelocityPerSprint = totalMonths > 0 
    ? Math.round((totalPoints / totalMonths / 2) * 10) / 10 
    : 0;
  
  return {
    monthlyVelocity: monthlyVelocityData,
    sprints: monthlyVelocityData, // Alias for backward compatibility
    averageVelocity: avgVelocityPerSprint,
    combinedAverageVelocity: avgVelocityPerSprint,
    totalPoints: totalPoints,
    totalMonths: totalMonths,
    totalSprints: totalMonths * 2,
    byBoard: null
  };
}

module.exports = {
  calculateVelocity
};
