/**
 * Build API URL with date range query parameters
 * @param {string} endpoint - API endpoint (e.g., '/api/stats')
 * @param {Object} dateRange - Date range object
 * @returns {string} Full URL with query params
 */
export function buildApiUrl(endpoint, dateRange) {
  const params = new URLSearchParams();
  
  if (dateRange?.type === 'dynamic') {
    params.append('range', dateRange.range);
  } else if (dateRange) {
    if (dateRange.start) params.append('start', dateRange.start);
    if (dateRange.end) params.append('end', dateRange.end);
  }
  
  const queryString = params.toString();
  return queryString ? `${endpoint}?${queryString}` : endpoint;
}

/**
 * Calculate filtered stats from PR/MR items
 * @param {Array} items - Array of PR/MR items
 * @param {Object} config - Configuration for determining item states
 * @returns {Object} Calculated stats
 */
export function calculateFilteredStats(items, config = {}) {
  const { isMerged, isOpen, isClosed, getSource } = config;
  
  const total = items.length;
  const merged = items.filter(item => isMerged?.(item) ?? false).length;
  const open = items.filter(item => isOpen?.(item) ?? false).length;
  const closed = items.filter(item => isClosed?.(item) ?? false).length;

  // Calculate items by month
  const itemsByMonth = {};
  items.forEach(item => {
    const date = item.created_at ? new Date(item.created_at) : null;
    if (date && !isNaN(date.getTime())) {
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      itemsByMonth[monthKey] = (itemsByMonth[monthKey] || 0) + 1;
    }
  });
  
  const monthlyCounts = Object.values(itemsByMonth);
  const avgPerMonth = monthlyCounts.length > 0
    ? monthlyCounts.reduce((a, b) => a + b, 0) / monthlyCounts.length
    : 0;

  // Calculate last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const last30Days = items.filter(item => {
    const date = item.updated_at ? new Date(item.updated_at) : null;
    return date && date >= thirtyDaysAgo;
  }).length;

  // Group by source if provided
  let bySource = {};
  if (getSource) {
    const sources = [...new Set(items.map(getSource))];
    sources.forEach(source => {
      const sourceItems = items.filter(item => getSource(item) === source);
      bySource[source] = {
        total: sourceItems.length,
        merged: sourceItems.filter(item => isMerged?.(item) ?? false).length,
        open: sourceItems.filter(item => isOpen?.(item) ?? false).length
      };
    });
  }

  return {
    total,
    merged,
    open,
    closed,
    avgPerMonth: Math.round(avgPerMonth * 10) / 10,
    last30Days,
    bySource
  };
}

/**
 * Get status classes for styling
 * @param {string} status - Status name
 * @returns {string} CSS classes
 */
export function getStatusClasses(status) {
  const statusMap = {
    'done': 'bg-green-100 text-green-800',
    'closed': 'bg-green-100 text-green-800',
    'resolved': 'bg-green-100 text-green-800',
    'in-progress': 'bg-blue-100 text-blue-800',
    'open': 'bg-yellow-100 text-yellow-800',
    'opened': 'bg-yellow-100 text-yellow-800',
    'to-do': 'bg-yellow-100 text-yellow-800',
    'backlog': 'bg-yellow-100 text-yellow-800',
    'blocked': 'bg-red-100 text-red-800',
    'merged': 'bg-blue-100 text-blue-800'
  };
  
  const normalizedStatus = status?.toLowerCase().replace(/\s+/g, '-');
  return statusMap[normalizedStatus] || 'bg-muted text-muted-foreground';
}

