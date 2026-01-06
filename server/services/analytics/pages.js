const cache = require('../../utils/cache');
const { apiRequest, ADOBE_REPORT_SUITE_ID } = require('./api');

/**
 * Get analytics data for a date range, optionally filtered by page
 */
async function getAnalyticsData(dateRange = null, pageFilter = null) {
  if (!ADOBE_REPORT_SUITE_ID) {
    throw new Error('ADOBE_REPORT_SUITE_ID is required');
  }

  const cacheKey = `adobe-analytics:${JSON.stringify(dateRange)}:${pageFilter || 'all'}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const today = new Date();
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  
  const startDate = dateRange?.start 
    ? new Date(dateRange.start).toISOString().split('T')[0] 
    : ninetyDaysAgo.toISOString().split('T')[0];
  const endDate = dateRange?.end 
    ? new Date(dateRange.end).toISOString().split('T')[0] 
    : today.toISOString().split('T')[0];

  const globalFilters = [{
    type: 'dateRange',
    dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
  }];

  const requestData = {
    rsid: ADOBE_REPORT_SUITE_ID,
    globalFilters,
    metricContainer: {
      metrics: [
        { id: 'metrics/visitors', columnId: '0' },
        { id: 'metrics/visits', columnId: '1' },
        { id: 'metrics/pageviews', columnId: '2' }
      ]
    },
    dimension: 'variables/daterangeday',
    settings: { countRepeatInstances: true, limit: 1000 }
  };

  if (pageFilter) {
    const pageSearch = await apiRequest('/reports', {
      method: 'POST',
      data: {
        rsid: ADOBE_REPORT_SUITE_ID,
        globalFilters,
        metricContainer: {
          metrics: [
            { id: 'metrics/visitors', columnId: '0' },
            { id: 'metrics/visits', columnId: '1' },
            { id: 'metrics/pageviews', columnId: '2' }
          ]
        },
        dimension: 'variables/page',
        search: { clause: `MATCH '${pageFilter}'` },
        settings: { countRepeatInstances: true, limit: 1 }
      }
    });

    const pageRow = pageSearch?.rows?.[0];
    if (!pageRow) {
      const result = { data: { rows: [], summaryData: { totals: [0, 0, 0] } }, dateRange: { start: startDate, end: endDate }, pageFilter };
      cache.set(cacheKey, result, 300);
      return result;
    }

    const pageTotals = pageRow.data;
    const pageItemId = pageRow.itemId;

    const breakdownData = await apiRequest('/reports', {
      method: 'POST', 
      data: {
        rsid: ADOBE_REPORT_SUITE_ID,
        globalFilters,
        metricContainer: {
          metrics: [
            { id: 'metrics/visitors', columnId: '0', filters: ['pageFilter'] },
            { id: 'metrics/visits', columnId: '1', filters: ['pageFilter'] },
            { id: 'metrics/pageviews', columnId: '2', filters: ['pageFilter'] }
          ],
          metricFilters: [{
            id: 'pageFilter',
            type: 'breakdown',
            dimension: 'variables/page',
            itemId: pageItemId
          }]
        },
        dimension: 'variables/daterangeday',
        settings: { countRepeatInstances: true, limit: 400 }
      }
    });

    const result = { 
      data: breakdownData, 
      dateRange: { start: startDate, end: endDate }, 
      pageFilter,
      pageTotals,
      timestamp: new Date().toISOString() 
    };
    cache.set(cacheKey, result, 300);
    return result;
  }

  const data = await apiRequest('/reports', {
    method: 'POST',
    data: requestData
  });

  const result = { data, dateRange: { start: startDate, end: endDate }, pageFilter, timestamp: new Date().toISOString() };
  cache.set(cacheKey, result, 300);
  return result;
}

/**
 * Get analytics for a single page filter
 */
async function getPageAnalytics(pageFilter, launchDate = null) {
  const analyticsData = await getAnalyticsData(null, pageFilter);
  const dailyData = (analyticsData.data?.rows || []).map(row => ({
    date: row.value,
    visitors: row.data?.[0] || 0,
    visits: row.data?.[1] || 0,
    pageViews: row.data?.[2] || 0
  })).sort((a, b) => a.date.localeCompare(b.date));

  const totals = analyticsData.pageTotals || analyticsData.data?.summaryData?.totals || [0, 0, 0];
  
  let comparison = null;
  if (launchDate) {
    const launchDateStr = launchDate.split('T')[0];
    
    const beforeData = dailyData.filter(d => {
      const dataDate = new Date(d.date + ' UTC');
      const launchDateObj = new Date(launchDateStr + 'T12:00:00Z');
      return dataDate < launchDateObj;
    });
    const afterData = dailyData.filter(d => {
      const dataDate = new Date(d.date + ' UTC');
      const launchDateObj = new Date(launchDateStr + 'T12:00:00Z');
      return dataDate >= launchDateObj;
    });
    
    const beforeAvg = beforeData.length > 0 
      ? beforeData.reduce((sum, d) => sum + d.pageViews, 0) / beforeData.length 
      : 0;
    const afterAvg = afterData.length > 0 
      ? afterData.reduce((sum, d) => sum + d.pageViews, 0) / afterData.length 
      : 0;
    
    comparison = {
      before: {
        avgPageViews: Math.round(beforeAvg),
        days: beforeData.length
      },
      after: {
        avgPageViews: Math.round(afterAvg),
        days: afterData.length
      },
      change: afterAvg > 0 && beforeAvg > 0 
        ? Math.round(((afterAvg - beforeAvg) / beforeAvg) * 100) 
        : null
    };
  }

  return {
    pageFilter,
    totals: {
      visitors: totals[0] || 0,
      visits: totals[1] || 0,
      pageViews: totals[2] || 0
    },
    dailyData,
    comparison,
    dateRange: analyticsData.dateRange
  };
}

/**
 * Get top pages from Adobe Analytics
 */
async function getTopPages(searchTerm = null, dimension = 'variables/page') {
  if (!ADOBE_REPORT_SUITE_ID) {
    throw new Error('ADOBE_REPORT_SUITE_ID is required');
  }

  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const startDate = thirtyDaysAgo.toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];

  const globalFilters = [{
    type: 'dateRange',
    dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
  }];

  const requestData = {
    rsid: ADOBE_REPORT_SUITE_ID,
    globalFilters,
    metricContainer: {
      metrics: [
        { id: 'metrics/pageviews', columnId: '0' }
      ]
    },
    dimension: dimension,
    settings: { countRepeatInstances: true, limit: 100 }
  };

  if (searchTerm) {
    requestData.search = {
      clause: `CONTAINS '${searchTerm}'`
    };
  }

  const data = await apiRequest('/reports', {
    method: 'POST',
    data: requestData
  });

  const pages = (data?.rows || []).map(row => ({
    page: row.value,
    pageViews: row.data?.[0] || 0
  }));

  return { 
    pages, 
    searchTerm,
    dimension,
    dateRange: { start: startDate, end: endDate },
    totalResults: data?.totalRows || pages.length,
    hint: searchTerm 
      ? `Showing ${dimension} matching "${searchTerm}"` 
      : `Top 100 by pageviews (${dimension}). Add ?search=term to filter.`
  };
}

/**
 * Find a specific page across multiple dimensions
 */
async function findPage(searchTerm) {
  if (!ADOBE_REPORT_SUITE_ID) {
    throw new Error('ADOBE_REPORT_SUITE_ID is required');
  }

  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const startDate = thirtyDaysAgo.toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];

  const dimensions = [
    'variables/page',
    'variables/pageurl', 
    'variables/pagepathname',
    'variables/evar1',
    'variables/evar2',
    'variables/prop1',
    'variables/prop2'
  ];

  const results = {};
  
  for (const dimension of dimensions) {
    try {
      const data = await apiRequest('/reports', {
        method: 'POST',
        data: {
          rsid: ADOBE_REPORT_SUITE_ID,
          globalFilters: [
            {
              type: 'dateRange',
              dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
            },
            {
              type: 'segment',
              segmentDefinition: {
                container: {
                  func: 'container',
                  context: 'hits',
                  pred: {
                    func: 'contains',
                    str: searchTerm,
                    val: { func: 'attr', name: dimension }
                  }
                }
              }
            }
          ],
          metricContainer: {
            metrics: [{ id: 'metrics/pageviews', columnId: '0' }]
          },
          dimension: dimension,
          settings: { countRepeatInstances: true, limit: 20 }
        }
      });

      const pages = (data?.rows || []).map(row => ({
        value: row.value,
        pageViews: row.data?.[0] || 0
      }));

      if (pages.length > 0) {
        results[dimension] = pages;
      }
    } catch (err) {
      results[dimension] = { error: err.message };
    }
  }

  return {
    searchTerm,
    dateRange: { start: startDate, end: endDate },
    results,
    hint: Object.keys(results).filter(k => Array.isArray(results[k]) && results[k].length > 0).length > 0
      ? 'Found matches! Use the dimension and value shown to configure your filter.'
      : 'No matches found. Try a different search term or check if this page has traffic.'
  };
}

/**
 * Format page names into readable labels
 */
function formatPageLabel(page) {
  const sportNames = {
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
    'other': 'Other'
  };
  
  const pageTypes = {
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
  
  const parts = page.split(':');
  const sport = sportNames[parts[0]] || parts[0]?.toUpperCase();
  const pageType = pageTypes[parts[1]] || parts[1];
  
  if (parts[0] === 'other') {
    return pageType ? `Other ${pageType}s` : page;
  }
  
  if (sport && pageType) {
    return `${sport} ${pageType}`;
  }
  return page;
}

/**
 * Extract page type from page name
 */
function extractPageTypeFromPageName(pageName) {
  if (!pageName) return 'other';
  const lower = pageName.toLowerCase();
  
  if (lower.includes('watchespn')) return 'watchespn';
  if (lower.includes(':fightcenter')) return 'fightcenter';
  
  if (lower.includes(':gamecast') || lower.includes('game:gamecast') || 
      lower.includes(':match') || lower.includes('game:match')) return 'gamecast';
  if (lower.includes(':scoreboard')) return 'scoreboard';
  if (lower.includes(':odds')) return 'odds';
  if (lower.includes(':futures')) return 'futures';
  if (lower.includes(':schedule')) return 'schedule';
  if (lower.includes('fantasy') || lower.includes(':games:')) return 'fantasy';
  if (lower.includes(':story')) return 'story';
  if (lower.includes(':index') || lower.includes(':frontpage')) return 'index';
  if (lower.includes('interstitial')) return 'interstitial';
  
  return 'other';
}

/**
 * Extract league from page name
 */
function extractLeagueFromPage(pageName) {
  if (!pageName) return null;
  const lower = pageName.toLowerCase();
  
  if (lower.includes(':nfl:') || lower.startsWith('nfl:')) return 'NFL';
  if (lower.includes(':nba:') || lower.startsWith('nba:')) return 'NBA';
  if (lower.includes(':ncf:') || lower.startsWith('ncf:')) return 'NCAAF';
  if (lower.includes(':ncb:') || lower.startsWith('ncb:')) return 'NCB';
  if (lower.includes(':nhl:') || lower.startsWith('nhl:')) return 'NHL';
  if (lower.includes(':mlb:') || lower.startsWith('mlb:')) return 'MLB';
  if (lower.includes(':soccer:') || lower.startsWith('soccer:')) return 'Soccer';
  if (lower.includes(':cricket:') || lower.includes('cricinfo')) return 'Cricket';
  
  return null;
}

/**
 * Extract league from evar67 string
 */
function extractLeagueFromEvar67(evar67) {
  if (!evar67) return null;
  const lower = evar67.toLowerCase();
  
  if (lower.includes(':nfl:') || lower.includes('espn:nfl')) return 'NFL';
  if (lower.includes(':nba:') || lower.includes('espn:nba')) return 'NBA';
  if (lower.includes(':ncf:') || lower.includes('espn:ncf')) return 'NCAAF';
  if (lower.includes(':ncb:') || lower.includes('espn:ncb')) return 'NCB';
  if (lower.includes(':nhl:') || lower.includes('espn:nhl')) return 'NHL';
  if (lower.includes(':mlb:') || lower.includes('espn:mlb')) return 'MLB';
  if (lower.includes(':soccer:') || lower.includes('espn:soccer')) return 'Soccer';
  if (lower.includes('cricket')) return 'Cricket';
  
  if (lower.includes(':football:')) return 'Football (NFL or NCAAF)';
  if (lower.includes(':basketball:')) return 'Basketball (NBA or NCB)';
  
  if (lower.includes('scoreboard:draft') || lower.startsWith('scoreboard:')) return 'Scoreboard (unknown league)';
  
  return null;
}

/**
 * Extract page type from evar67
 */
function extractPageTypeFromEvar67(evar67) {
  if (!evar67) return null;
  const lower = evar67.toLowerCase();
  
  if (lower.includes('gamecast')) return 'gamecast';
  if (lower.includes('scoreboard')) return 'scoreboard';
  if (lower.includes('odds')) return 'odds';
  if (lower.includes('story')) return 'story';
  if (lower.includes('index')) return 'index';
  
  return 'other';
}

module.exports = {
  getAnalyticsData,
  getPageAnalytics,
  getTopPages,
  findPage,
  formatPageLabel,
  extractPageTypeFromPageName,
  extractLeagueFromPage,
  extractLeagueFromEvar67,
  extractPageTypeFromEvar67
};

