/**
 * Shared analytics utility functions for the server
 */

/**
 * Get date range for analytics queries
 * @param {number} days - Number of days back from today (default 90)
 * @returns {{ startDate: string, endDate: string, dateRangeFilter: string }}
 */
function getDateRange(days = 90) {
  const today = new Date();
  const pastDate = new Date(today);
  pastDate.setDate(pastDate.getDate() - days);
  
  const startDate = pastDate.toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];
  
  return {
    startDate,
    endDate,
    dateRangeFilter: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
  };
}

/**
 * Create standard global filters for Adobe Analytics requests
 * @param {number} days - Number of days back from today
 * @returns {Array} Global filters array
 */
function createGlobalFilters(days = 90) {
  const { dateRangeFilter } = getDateRange(days);
  return [{
    type: 'dateRange',
    dateRange: dateRangeFilter
  }];
}

/**
 * Parse a date string and return the YYYY-MM-DD portion
 * @param {string} dateStr - Date string (ISO or other format)
 * @returns {string} Date in YYYY-MM-DD format
 */
function parseDateToISO(dateStr) {
  if (!dateStr) return null;
  // Handle ISO format
  if (dateStr.includes('T')) {
    return dateStr.split('T')[0];
  }
  // Handle other formats by parsing
  const d = new Date(dateStr);
  return d.toISOString().split('T')[0];
}

/**
 * Calculate comparison stats for before/after launch
 * @param {Array} dailyData - Array of { date, value } objects
 * @param {string} launchDate - Launch date in YYYY-MM-DD format
 * @param {string} valueKey - Key to use for the value (default 'clicks')
 * @returns {Object|null} Comparison stats or null
 */
function calculateComparison(dailyData, launchDate, valueKey = 'clicks') {
  if (!dailyData || dailyData.length === 0 || !launchDate) return null;

  const launchDateObj = new Date(launchDate + 'T12:00:00');
  const beforeData = dailyData.filter(d => new Date(d.date) < launchDateObj);
  const afterData = dailyData.filter(d => new Date(d.date) >= launchDateObj);

  const sumBefore = beforeData.reduce((sum, d) => sum + (d[valueKey] || 0), 0);
  const sumAfter = afterData.reduce((sum, d) => sum + (d[valueKey] || 0), 0);

  const avgBefore = beforeData.length > 0 ? Math.round(sumBefore / beforeData.length) : 0;
  const avgAfter = afterData.length > 0 ? Math.round(sumAfter / afterData.length) : 0;

  const changePercent = avgBefore > 0
    ? Math.round(((avgAfter - avgBefore) / avgBefore) * 100)
    : avgAfter > 0 ? 100 : 0;

  return {
    avgClicksBefore: avgBefore,
    avgClicksAfter: avgAfter,
    daysBefore: beforeData.length,
    daysAfter: afterData.length,
    changePercent
  };
}

/**
 * Known sports mappings for Adobe Analytics
 */
const SPORTS_MAP = {
  'nfl': 'NFL',
  'nba': 'NBA',
  'nhl': 'NHL',
  'mlb': 'MLB',
  'ncaaf': 'College Football',
  'ncaab': 'College Basketball',
  'ncaam': 'College Basketball',
  'ncaaw': 'Women\'s College Basketball',
  'soccer': 'Soccer',
  'mma': 'MMA',
  'wnba': 'WNBA',
  'college-football': 'College Football',
  'mens-college-basketball': 'College Basketball',
  'other': 'Other'
};

/**
 * Known page types for Adobe Analytics
 */
const PAGE_TYPES = {
  'gamecast': 'Gamecast',
  'scoreboard': 'Scoreboard',
  'schedule': 'Schedule',
  'odds': 'Odds',
  'standings': 'Standings',
  'boxscore': 'Box Score',
  'fightcenter': 'Fight Center',
  'index': 'Index',
  'scores': 'Scores'
};

/**
 * Page type emojis for display
 */
const PAGE_TYPE_EMOJIS = {
  'odds': '🎰',
  'gamecast': '📺',
  'schedule': '📅',
  'scoreboard': '📊',
  'standings': '🏆',
  'boxscore': '📋',
  'index': '🏠',
  'scores': '⚽',
  'fightcenter': '🥊'
};

/**
 * Format page name to friendly label
 * @param {string} page - Page identifier (e.g., "nfl:gamecast")
 * @returns {string} Formatted label (e.g., "NFL Gamecast")
 */
function formatPageLabel(page) {
  const parts = page.split(':');
  const sport = SPORTS_MAP[parts[0]] || parts[0]?.toUpperCase();
  const pageType = PAGE_TYPES[parts[1]] || parts[1];
  
  if (parts[0] === 'other') {
    return pageType ? `All ${pageType}s` : page;
  }
  
  if (sport && pageType) {
    return `${sport} ${pageType}`;
  }
  return page;
}

/**
 * Format page type to friendly label with emoji
 * @param {string} pageType - Page type identifier
 * @returns {string} Formatted label with emoji
 */
function formatPageTypeLabel(pageType) {
  const icon = PAGE_TYPE_EMOJIS[pageType] || '📄';
  const label = pageType.charAt(0).toUpperCase() + pageType.slice(1);
  return `${icon} ${label} Pages`;
}

/**
 * Parse page context from evar67 value
 * @param {string} value - evar67 value from Adobe Analytics
 * @returns {string|null} Parsed page name or null
 */
function parsePageFromEvar67(value) {
  const valueLower = (value || '').toLowerCase();
  
  // Known sports to look for
  const sports = ['nfl', 'nba', 'nhl', 'mlb', 'ncaaf', 'ncaab', 'ncaam', 'soccer', 'mma', 'wnba', 'college-football', 'mens-college-basketball'];
  
  // Known page types (check more specific first)
  const pageTypes = ['gamecast', 'scoreboard', 'schedule', 'odds', 'standings', 'boxscore', 'fightcenter', 'index', 'scores'];
  
  // Find sport in the value
  let foundSport = null;
  for (const sport of sports) {
    if (valueLower.includes(`:${sport}:`) || valueLower.includes(`espn:${sport}`)) {
      foundSport = sport;
      // Normalize college sports
      if (foundSport === 'college-football') foundSport = 'ncaaf';
      if (foundSport === 'mens-college-basketball') foundSport = 'ncaab';
      break;
    }
  }
  
  // Find page type
  let foundPageType = null;
  for (const pt of pageTypes) {
    if (valueLower.includes(`:${pt}:`) || valueLower.includes(`:${pt}`)) {
      foundPageType = pt;
      break;
    }
  }
  
  // Special case: match:gamecast for soccer
  if (valueLower.includes(':match:gamecast')) {
    foundPageType = 'gamecast';
    if (!foundSport) foundSport = 'soccer';
  }
  
  // Special case: game:gamecast
  if (valueLower.includes(':game:gamecast')) {
    foundPageType = 'gamecast';
  }
  
  // Return sport:pageType if both found
  if (foundSport && foundPageType) {
    return `${foundSport}:${foundPageType}`;
  }
  
  // If only pageType found (generic)
  if (foundPageType) {
    return `other:${foundPageType}`;
  }
  
  return null;
}

module.exports = {
  getDateRange,
  createGlobalFilters,
  parseDateToISO,
  calculateComparison,
  formatPageLabel,
  formatPageTypeLabel,
  parsePageFromEvar67,
  SPORTS_MAP,
  PAGE_TYPES,
  PAGE_TYPE_EMOJIS
};

