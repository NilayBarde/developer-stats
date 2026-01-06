const { getAnalyticsData } = require('./pages');

// Re-export all functions from sub-modules
const api = require('./api');
const pages = require('./pages');
const clicks = require('./clicks');
const projects = require('./projects');
const discovery = require('./discovery');

/**
 * Get stats summary
 */
async function getStats(dateRange = null) {
  try {
    const analyticsData = await getAnalyticsData(dateRange);
    const totals = analyticsData.data?.summaryData?.totals || [0, 0, 0];
    
    const dailyData = (analyticsData.data?.rows || []).map(row => ({
      date: row.value,
      visitors: row.data?.[0] || 0,
      visits: row.data?.[1] || 0,
      pageViews: row.data?.[2] || 0
    }));
    
    return {
      totalVisitors: totals[0],
      totalVisits: totals[1],
      totalPageViews: totals[2],
      dailyData,
      dateRange: analyticsData.dateRange,
      timestamp: analyticsData.timestamp
    };
  } catch (error) {
    console.error('Adobe Analytics error:', error.message);
    return { error: error.message };
  }
}

module.exports = {
  // Stats orchestration
  getStats,
  
  // API client
  ...api,
  
  // Page analytics
  ...pages,
  
  // Click tracking
  ...clicks,
  
  // Project analytics
  ...projects,
  
  // Discovery/exploration (may be removed in future)
  ...discovery
};
