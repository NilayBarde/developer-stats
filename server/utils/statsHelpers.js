const { filterByDateRange, calculateMonthlyStats, calculateTimePeriodStats, formatDateRangeForResponse } = require('./dateHelpers');

/**
 * Calculate average time to merge/resolve
 */
function calculateAverageTime(items, createdField, mergedField) {
  const mergedItems = items.filter(item => {
    const created = new Date(item[createdField]);
    const merged = item[mergedField] ? new Date(item[mergedField]) : null;
    return merged && !isNaN(merged.getTime());
  });

  if (mergedItems.length === 0) return 0;

  const times = mergedItems.map(item => {
    const created = new Date(item[createdField]);
    const merged = new Date(item[mergedField]);
    return (merged - created) / (1000 * 60 * 60 * 24); // days
  });

  return Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10;
}

/**
 * Calculate basic stats (total, merged, open, closed, etc.)
 */
function calculateBasicStats(items, stateConfig) {
  const { getState, isMerged, isOpen, isClosed } = stateConfig;
  
  return {
    total: items.length,
    merged: items.filter(item => isMerged(item)).length,
    open: items.filter(item => isOpen(item)).length,
    closed: items.filter(item => isClosed(item)).length
  };
}

/**
 * Group items by a key field
 */
function groupBy(items, keyFn, statsFn) {
  const groups = {};
  
  items.forEach(item => {
    const key = keyFn(item);
    if (!groups[key]) {
      groups[key] = { total: 0, merged: 0, open: 0 };
    }
    groups[key].total++;
    if (statsFn) {
      statsFn(groups[key], item);
    }
  });
  
  return groups;
}

/**
 * Calculate comprehensive stats for PRs/MRs
 */
function calculatePRStats(items, comments, dateRange, config) {
  const {
    dateField = 'created_at',
    mergedField,
    stateField = 'state',
    getState,
    isMerged,
    isOpen,
    isClosed,
    groupByKey
  } = config;

  // Filter to date range
  const filteredItems = filterByDateRange(items, dateField, dateRange);

  // Basic stats
  const timePeriodStats = calculateTimePeriodStats(filteredItems, dateField);
  const basicStats = calculateBasicStats(filteredItems, { getState, isMerged, isOpen, isClosed });
  
  // Average time to merge
  const avgTimeToMerge = calculateAverageTime(filteredItems, dateField, mergedField);

  // Monthly stats (all PRs/MRs by created date)
  const monthlyItems = calculateMonthlyStats(filteredItems, dateField, dateRange);
  
  // Monthly merged stats (only merged items, by merge date)
  const mergedItems = filteredItems.filter(item => isMerged(item) && item[mergedField]);
  const monthlyMerged = calculateMonthlyStats(mergedItems, mergedField, dateRange);

  // Group by repository/project
  const grouped = groupByKey 
    ? groupBy(filteredItems, groupByKey, (group, item) => {
        if (isMerged(item)) group.merged++;
        else if (isOpen(item)) group.open++;
      })
    : {};

  // Calculate repo breakdown (repos where user authored PRs/MRs)
  const reposAuthored = new Set();
  const repoBreakdown = {};
  
  filteredItems.forEach(item => {
    let repoKey = null;
    if (groupByKey) {
      repoKey = groupByKey(item);
    } else if (item.repository_url) {
      // GitHub: extract repo from repository_url
      const match = item.repository_url.match(/repos\/(.+)$/);
      repoKey = match ? match[1] : null;
    } else if (item.project_id) {
      // GitLab: use project_id
      repoKey = item.project_id.toString();
    }
    
    if (repoKey) {
      reposAuthored.add(repoKey);
      if (!repoBreakdown[repoKey]) {
        repoBreakdown[repoKey] = {
          total: 0,
          merged: 0,
          open: 0,
          closed: 0
        };
      }
      repoBreakdown[repoKey].total++;
      if (isMerged(item)) repoBreakdown[repoKey].merged++;
      else if (isOpen(item)) repoBreakdown[repoKey].open++;
      else if (isClosed(item)) repoBreakdown[repoKey].closed++;
    }
  });

  // Helper function to sort items by date descending
  const sortByDateDesc = (a, b) => {
    const dateA = new Date(a[dateField]);
    const dateB = new Date(b[dateField]);
    return dateB - dateA;
  };

  // Get current month items (all items from current month)
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();
  
  const currentMonthItems = filteredItems
    .filter(item => {
      const itemDate = new Date(item[dateField]);
      if (isNaN(itemDate.getTime())) return false;
      return itemDate.getUTCFullYear() === currentYear && 
             itemDate.getUTCMonth() === currentMonth;
    })
    .sort(sortByDateDesc);

  // If no current month items, return recent 5 sorted by date
  // Otherwise, return top 5 from current month
  const itemsToReturn = currentMonthItems.length > 0 
    ? currentMonthItems.slice(0, 5)
    : filteredItems.sort(sortByDateDesc).slice(0, 5);

  return {
    ...basicStats,
    ...timePeriodStats,
    avgTimeToMerge,
    monthlyPRs: monthlyItems.monthly,
    monthlyMRs: monthlyItems.monthly, // Alias for GitLab compatibility
    monthlyMerged: monthlyMerged.monthly, // PRs/MRs merged per month
    avgPRsPerMonth: monthlyItems.averagePerMonth,
    avgMRsPerMonth: monthlyItems.averagePerMonth, // Alias for GitLab compatibility
    grouped,
    reposAuthored: reposAuthored.size,
    repoBreakdown: Object.entries(repoBreakdown)
      .map(([repo, stats]) => ({ repo, ...stats }))
      .sort((a, b) => b.total - a.total), // Sort by total descending
    items: itemsToReturn,
    dateRange: formatDateRangeForResponse(dateRange)
  };
}

module.exports = {
  calculateAverageTime,
  calculateBasicStats,
  groupBy,
  calculatePRStats
};

