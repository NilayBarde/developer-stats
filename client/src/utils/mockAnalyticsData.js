/**
 * Mock Adobe Analytics data for development/demo purposes
 * This will be replaced with real API data when permissions are obtained
 */

// Generate mock daily data for the past N days
function generateDailyData(days = 30, baseMultiplier = 1) {
  const data = [];
  const today = new Date();
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    
    // Add some realistic variation
    const baseVisitors = (5000 + Math.random() * 8000) * baseMultiplier;
    const weekday = date.getDay();
    const weekendMultiplier = (weekday === 0 || weekday === 6) ? 1.3 : 1; // Higher on weekends for ESPN
    
    data.push({
      date: date.toISOString().split('T')[0],
      dateLabel: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      visitors: Math.round(baseVisitors * weekendMultiplier),
      visits: Math.round(baseVisitors * weekendMultiplier * 1.4),
      pageViews: Math.round(baseVisitors * weekendMultiplier * 4.2),
    });
  }
  
  return data;
}

// Generate mock data by page/section
function generatePageData() {
  return [
    { page: 'Homepage', pageViews: 125000, avgTimeOnPage: '2:45', bounceRate: 32 },
    { page: 'NFL Scores', pageViews: 98000, avgTimeOnPage: '4:12', bounceRate: 18 },
    { page: 'NBA Scores', pageViews: 87000, avgTimeOnPage: '3:58', bounceRate: 21 },
    { page: 'Fantasy Football', pageViews: 76000, avgTimeOnPage: '6:30', bounceRate: 12 },
    { page: 'MLB Standings', pageViews: 54000, avgTimeOnPage: '3:15', bounceRate: 28 },
    { page: 'Soccer News', pageViews: 48000, avgTimeOnPage: '2:55', bounceRate: 35 },
    { page: 'College Football', pageViews: 42000, avgTimeOnPage: '4:45', bounceRate: 15 },
    { page: 'NHL Scores', pageViews: 38000, avgTimeOnPage: '3:22', bounceRate: 24 },
  ];
}

// Generate mock referrer data
function generateReferrerData() {
  return [
    { source: 'Google Search', visits: 145000, percentage: 38 },
    { source: 'Direct', visits: 98000, percentage: 26 },
    { source: 'Social Media', visits: 68000, percentage: 18 },
    { source: 'ESPN App', visits: 45000, percentage: 12 },
    { source: 'Other', visits: 24000, percentage: 6 },
  ];
}

// Generate mock device data
function generateDeviceData() {
  return [
    { device: 'Mobile', visits: 210000, percentage: 55 },
    { device: 'Desktop', visits: 133000, percentage: 35 },
    { device: 'Tablet', visits: 38000, percentage: 10 },
  ];
}

// Main export function
export function getMockAnalyticsData(dateRange = {}) {
  const dailyData = generateDailyData(30);
  
  const totals = dailyData.reduce((acc, day) => ({
    visitors: acc.visitors + day.visitors,
    visits: acc.visits + day.visits,
    pageViews: acc.pageViews + day.pageViews,
  }), { visitors: 0, visits: 0, pageViews: 0 });
  
  return {
    isMockData: true, // Flag to indicate this is mock data
    summary: {
      uniqueVisitors: totals.visitors,
      totalVisits: totals.visits,
      totalPageViews: totals.pageViews,
      avgSessionDuration: '3:42',
      bounceRate: 24.5,
      pagesPerSession: 3.8,
    },
    dailyData,
    topPages: generatePageData(),
    referrers: generateReferrerData(),
    devices: generateDeviceData(),
    dateRange: {
      start: dailyData[0]?.date,
      end: dailyData[dailyData.length - 1]?.date,
    },
  };
}

// Generate mock analytics for a specific project/epic
export function getMockProjectAnalytics(projectName, epicKey) {
  // Use project name to seed consistent but varied data
  const seed = projectName.length + (epicKey?.length || 0);
  const baseMultiplier = 0.3 + (seed % 10) / 10; // 0.3 to 1.3
  
  const dailyData = generateDailyData(14, baseMultiplier); // 2 weeks of data
  
  const totals = dailyData.reduce((acc, day) => ({
    visitors: acc.visitors + day.visitors,
    visits: acc.visits + day.visits,
    pageViews: acc.pageViews + day.pageViews,
  }), { visitors: 0, visits: 0, pageViews: 0 });
  
  // Generate project-specific pages based on project name
  const projectPages = [
    { page: `${projectName} - Main`, pageViews: Math.round(totals.pageViews * 0.35), avgTimeOnPage: '2:30', bounceRate: Math.round(20 + Math.random() * 15) },
    { page: `${projectName} - Details`, pageViews: Math.round(totals.pageViews * 0.25), avgTimeOnPage: '3:45', bounceRate: Math.round(15 + Math.random() * 10) },
    { page: `${projectName} - Stats`, pageViews: Math.round(totals.pageViews * 0.20), avgTimeOnPage: '4:10', bounceRate: Math.round(10 + Math.random() * 15) },
    { page: `${projectName} - Settings`, pageViews: Math.round(totals.pageViews * 0.12), avgTimeOnPage: '1:55', bounceRate: Math.round(25 + Math.random() * 20) },
    { page: `${projectName} - Help`, pageViews: Math.round(totals.pageViews * 0.08), avgTimeOnPage: '2:15', bounceRate: Math.round(30 + Math.random() * 15) },
  ];
  
  return {
    isMockData: true,
    projectName,
    epicKey,
    summary: {
      uniqueVisitors: totals.visitors,
      totalVisits: totals.visits,
      totalPageViews: totals.pageViews,
      avgSessionDuration: `${2 + Math.floor(Math.random() * 3)}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}`,
      bounceRate: Math.round(18 + Math.random() * 15),
      pagesPerSession: (2.5 + Math.random() * 2).toFixed(1),
    },
    dailyData,
    topPages: projectPages,
    devices: generateDeviceData(),
    dateRange: {
      start: dailyData[0]?.date,
      end: dailyData[dailyData.length - 1]?.date,
    },
  };
}

// Re-export formatNumber from shared helpers for backward compatibility
export { formatNumber } from './analyticsHelpers';

