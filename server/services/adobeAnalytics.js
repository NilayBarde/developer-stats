const axios = require('axios');
const cache = require('../utils/cache');

// Adobe Analytics API credentials (OAuth Server-to-Server)
const ADOBE_CLIENT_ID = process.env.ADOBE_CLIENT_ID;
const ADOBE_CLIENT_SECRET = process.env.ADOBE_CLIENT_SECRET;
const ADOBE_ORG_ID = process.env.ADOBE_ORG_ID;
const ADOBE_REPORT_SUITE_ID = process.env.ADOBE_REPORT_SUITE_ID;

// Cached values
let accessTokenCache = { token: null, expiresAt: null };
let globalCompanyId = null;

// All Bet Clicks segment ID (DraftKings + ESPN Bet) - created by Nilay
const ALL_BET_CLICKS_SEGMENT_ID = 's300003201_694c7a0c873e3d78f596f84f';

// NOTE: Page-specific segments are NO LONGER NEEDED!
// The multi-column matrix approach gives us exact daily data for ALL pages in just 2 API calls.

/**
 * Get OAuth access token (cached)
 */
async function getAccessToken() {
  if (accessTokenCache.token && Date.now() < accessTokenCache.expiresAt) {
    return accessTokenCache.token;
  }

  if (!ADOBE_CLIENT_ID || !ADOBE_CLIENT_SECRET || !ADOBE_ORG_ID) {
    throw new Error('Adobe Analytics credentials not configured');
  }

  const tokenData = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: ADOBE_CLIENT_ID,
    client_secret: ADOBE_CLIENT_SECRET,
    scope: 'openid,AdobeID,additional_info.projectedProductContext'
  });

  const response = await axios.post(
    'https://ims-na1.adobelogin.com/ims/token/v3',
    tokenData.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  accessTokenCache.token = response.data.access_token;
  accessTokenCache.expiresAt = Date.now() + ((response.data.expires_in - 3600) * 1000);
  
  return accessTokenCache.token;
}

/**
 * Retry a request with exponential backoff for 429 rate limit errors
 * Adobe limit: 12 requests per 6 seconds (2/sec)
 */
async function retryWithBackoff(requestFn, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await requestFn();
    } catch (error) {
      lastError = error;
      if (error.response?.status === 429) {
        // Get retry-after header (in seconds) or default to exponential backoff
        const retryAfter = parseInt(error.response.headers?.['retry-after'] || '2', 10);
        const waitTime = Math.max(retryAfter * 1000, (attempt + 1) * 2000); // At least retry-after seconds
        console.log(`  ⏳ Rate limited (429). Waiting ${waitTime/1000}s before retry ${attempt + 1}/${maxRetries}...`);
        await new Promise(r => setTimeout(r, waitTime));
      } else {
        throw error; // Non-429 errors should not be retried
      }
    }
  }
  throw lastError;
}

/**
 * Discover Global Company ID from Adobe API (cached)
 */
async function getGlobalCompanyId() {
  if (globalCompanyId) return globalCompanyId;
  
  const token = await getAccessToken();
  const response = await retryWithBackoff(() => 
    axios.get('https://analytics.adobe.io/discovery/me', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-api-key': ADOBE_CLIENT_ID
    }
    })
  );
  
  globalCompanyId = response.data?.imsOrgs?.[0]?.companies?.[0]?.globalCompanyId;
  if (!globalCompanyId) throw new Error('Could not discover Global Company ID');
  
  return globalCompanyId;
}

/**
 * Make authenticated request to Adobe Analytics API
 */
async function apiRequest(endpoint, options = {}) {
  const token = await getAccessToken();
  const companyId = await getGlobalCompanyId();
  const timeout = options.timeout || 30000; // Default 30s, can be overridden
  
  return retryWithBackoff(() => 
    axios({
    url: `https://analytics.adobe.io/api/${companyId}${endpoint}`,
    method: options.method || 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-api-key': ADOBE_CLIENT_ID,
      'x-gw-ims-org-id': ADOBE_ORG_ID,
      'Content-Type': 'application/json'
    },
    data: options.data,
    timeout
    }).then(res => res.data)
  );
}

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

  // Default to last 90 days for trend data
  const today = new Date();
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  
  const startDate = dateRange?.start 
    ? new Date(dateRange.start).toISOString().split('T')[0] 
    : ninetyDaysAgo.toISOString().split('T')[0];
  const endDate = dateRange?.end 
    ? new Date(dateRange.end).toISOString().split('T')[0] 
    : today.toISOString().split('T')[0];

  // Build filters
  const globalFilters = [{
    type: 'dateRange',
    dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
  }];

  // Build request data
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

  // If page filter is specified, first get page totals then do breakdown
  if (pageFilter) {
    // Step 1: Get the page and its itemId using search
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

    // Step 2: Get day breakdown using metricsFilters with the page itemId
    const breakdownData = await apiRequest('/reports', {
      method: 'POST', 
      data: {
        rsid: ADOBE_REPORT_SUITE_ID,
        globalFilters,
        metricContainer: {
          metrics: [
            { 
              id: 'metrics/visitors', 
              columnId: '0',
              filters: ['pageFilter']
            },
            { 
              id: 'metrics/visits', 
              columnId: '1',
              filters: ['pageFilter']
            },
            { 
              id: 'metrics/pageviews', 
              columnId: '2',
              filters: ['pageFilter']
            }
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
 * Get click/interaction analytics for a page
 */
async function getClickAnalytics(pageFilter, launchDate = null) {
  if (!ADOBE_REPORT_SUITE_ID) {
    throw new Error('ADOBE_REPORT_SUITE_ID is required');
  }

  const today = new Date();
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  
  const startDate = ninetyDaysAgo.toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];

  const globalFilters = [{
    type: 'dateRange',
    dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
  }];

  // Get click events (occurrences) broken down by evar or prop containing event details
  // First, let's get the total clicks/interactions for this page
  const clickData = await apiRequest('/reports', {
    method: 'POST',
    data: {
      rsid: ADOBE_REPORT_SUITE_ID,
      globalFilters,
      metricContainer: {
        metrics: [
          { id: 'metrics/occurrences', columnId: '0' }
        ]
      },
      dimension: 'variables/evar61', // Common evar for event_detail - adjust as needed
      search: pageFilter ? { clause: `CONTAINS '${pageFilter}'` } : undefined,
      settings: { countRepeatInstances: true, limit: 50 }
    }
  });

  // Get daily click trend
  const dailyClicks = await apiRequest('/reports', {
    method: 'POST',
    data: {
      rsid: ADOBE_REPORT_SUITE_ID,
      globalFilters: [
        ...globalFilters,
        // Filter for link tracking hits only
        {
          type: 'segment',
          segmentDefinition: {
            container: {
              func: 'container',
              context: 'hits',
              pred: {
                func: 'exists',
                val: { func: 'attr', name: 'variables/clickmaplink' }
              }
            }
          }
        }
      ],
      metricContainer: {
        metrics: [
          { id: 'metrics/occurrences', columnId: '0' }
        ]
      },
      dimension: 'variables/daterangeday',
      settings: { countRepeatInstances: true, limit: 400 }
    }
  });

  const topClicks = (clickData?.rows || []).map(row => ({
    label: row.value,
    clicks: row.data?.[0] || 0
  }));

  const dailyData = (dailyClicks?.rows || []).map(row => ({
    date: row.value,
    clicks: row.data?.[0] || 0
  })).sort((a, b) => new Date(a.date) - new Date(b.date));

  const totalClicks = topClicks.reduce((sum, r) => sum + r.clicks, 0);

  return {
    totalClicks,
    topClicks,
    dailyData,
    dateRange: { start: startDate, end: endDate }
  };
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

  // Use pageTotals (from page-specific request) if available, otherwise fall back to summaryData
  const totals = analyticsData.pageTotals || analyticsData.data?.summaryData?.totals || [0, 0, 0];
  
  // Calculate before/after if launch date is provided
  let comparison = null;
  if (launchDate) {
    // Parse launch date - handle both "YYYY-MM-DD" and "Mon DD, YYYY" formats
    const launchDateStr = launchDate.split('T')[0]; // Get YYYY-MM-DD part
    
    // Convert daily data dates to comparable format
    const beforeData = dailyData.filter(d => {
      // d.date is like "Dec 1, 2025" - need to compare properly
      const dataDate = new Date(d.date + ' UTC');
      const launchDateObj = new Date(launchDateStr + 'T12:00:00Z');
      return dataDate < launchDateObj;
    });
    const afterData = dailyData.filter(d => {
      const dataDate = new Date(d.date + ' UTC');
      const launchDateObj = new Date(launchDateStr + 'T12:00:00Z');
      return dataDate >= launchDateObj;
    });
    
    const avgBefore = beforeData.length > 0 
      ? beforeData.reduce((sum, d) => sum + d.pageViews, 0) / beforeData.length 
      : 0;
    const avgAfter = afterData.length > 0 
      ? afterData.reduce((sum, d) => sum + d.pageViews, 0) / afterData.length 
      : 0;
    
    comparison = {
      launchDate,
      avgPageViewsBefore: Math.round(avgBefore),
      avgPageViewsAfter: Math.round(avgAfter),
      changePercent: avgBefore > 0 ? Math.round(((avgAfter - avgBefore) / avgBefore) * 100) : null,
      daysBefore: beforeData.length,
      daysAfter: afterData.length
    };
  }

  return {
    totalVisitors: totals[0],
    totalVisits: totals[1],
    totalPageViews: totals[2],
    dailyData,
    comparison,
    dateRange: analyticsData.dateRange
  };
}

/**
 * Get analytics for a specific project (supports single-page and multi-page tracking)
 */
async function getProjectAnalytics(projectConfig) {
  if (!projectConfig || !projectConfig.enabled) {
    return null;
  }

  try {
    const { trackingType, pages, pageFilter, launchDate, label } = projectConfig;
    
    // Multi-page tracking - fetch analytics for each page category
    if (trackingType === 'multi-page' && pages && pages.length > 0) {
      const pageResults = await Promise.all(
        pages.map(async (page) => {
          try {
            const analytics = await getPageAnalytics(page.filter, launchDate);
            return {
              filter: page.filter,
              label: page.label,
              status: page.status || 'live',
              ...analytics
            };
          } catch (error) {
            return {
              filter: page.filter,
              label: page.label,
              status: page.status || 'live',
              error: error.message
            };
          }
        })
      );
      
      // Calculate totals across all pages
      const totalPageViews = pageResults.reduce((sum, p) => sum + (p.totalPageViews || 0), 0);
      const totalVisitors = pageResults.reduce((sum, p) => sum + (p.totalVisitors || 0), 0);
      
      return {
        trackingType: 'multi-page',
        label: label || 'Analytics',
        launchDate,
        pages: pageResults,
        totalPageViews,
        totalVisitors,
        dateRange: pageResults[0]?.dateRange
      };
    }
    
    // Single-page tracking (original behavior)
    // Only fetch page analytics if trackPageViews is not explicitly false
    let analytics = {};
    if (projectConfig.trackPageViews !== false && pageFilter) {
      analytics = await getPageAnalytics(pageFilter, launchDate);
    }
    
    // Also fetch click data if configured
    let clicks = null;
    if (projectConfig.trackClicks) {
      try {
        // Use clickEventFilter (evar67 search) if configured
        if (projectConfig.clickEventFilter) {
          const clickData = await getOddsPageClicks(launchDate, projectConfig.clickEventFilter);
          
          // Convert daily array to map for chart tooltip
          const dailyClicksMap = {};
          (clickData.dailyClicks || []).forEach(d => {
            dailyClicksMap[d.date] = { clicks: d.clicks };
          });
          
          clicks = {
            totalClicks: clickData.totalClicks,
            espnBetClicks: clickData.espnBetClicks,
            draftKingsClicks: clickData.draftKingsClicks,
            clickEventFilter: projectConfig.clickEventFilter,
            dailyClicks: dailyClicksMap,
            comparison: clickData.comparison
          };
        } else if (projectConfig.clickFilterBefore && projectConfig.clickFilterAfter) {
          // Different click pages before/after launch - fetch both
          const { clickFilterBefore, clickFilterAfter } = projectConfig;
          const [beforeClicks, afterClicks] = await Promise.all([
            getPageAnalytics(clickFilterBefore, launchDate),
            getPageAnalytics(clickFilterAfter, launchDate)
          ]);
          
          // Combine daily data from both
          const beforeDaily = beforeClicks.dailyData || [];
          const afterDaily = afterClicks.dailyData || [];
          
          // Calculate averages - before launch uses espnbet, after uses betting
          const launchDateObj = new Date(launchDate + 'T12:00:00');
          
          const avgClicksBefore = beforeDaily.filter(d => new Date(d.date) < launchDateObj)
            .reduce((sum, d) => sum + d.pageViews, 0) / 
            Math.max(1, beforeDaily.filter(d => new Date(d.date) < launchDateObj).length);
          
          const avgClicksAfter = afterDaily.filter(d => new Date(d.date) >= launchDateObj)
            .reduce((sum, d) => sum + d.pageViews, 0) /
            Math.max(1, afterDaily.filter(d => new Date(d.date) >= launchDateObj).length);
          
          const changePercent = avgClicksBefore > 0 
            ? Math.round(((avgClicksAfter - avgClicksBefore) / avgClicksBefore) * 100) 
            : null;
          
          // Merge daily click data from both sources
          const dailyClicksMap = {};
          beforeDaily.forEach(d => {
            dailyClicksMap[d.date] = { clicks: d.pageViews };
          });
          afterDaily.forEach(d => {
            if (!dailyClicksMap[d.date]) {
              dailyClicksMap[d.date] = { clicks: 0 };
            }
            dailyClicksMap[d.date].clicks += d.pageViews;
          });
          
          clicks = {
            totalClicksBefore: beforeClicks.totalPageViews,
            totalClicksAfter: afterClicks.totalPageViews,
            totalClicks: beforeClicks.totalPageViews + afterClicks.totalPageViews,
            clickFilterBefore,
            clickFilterAfter,
            dailyClicks: dailyClicksMap,
            comparison: {
              avgClicksBefore: Math.round(avgClicksBefore),
              avgClicksAfter: Math.round(avgClicksAfter),
              changePercent
            }
          };
        } else if (projectConfig.clickFilter) {
          // Single click filter (legacy config)
          const clickData = await getPageAnalytics(projectConfig.clickFilter, launchDate);
          clicks = {
            totalClicks: clickData.totalPageViews,
            clickFilter: projectConfig.clickFilter,
            dailyClicks: clickData.dailyData.map(d => ({ date: d.date, clicks: d.pageViews })),
            comparison: clickData.comparison ? {
              avgClicksBefore: clickData.comparison.avgPageViewsBefore,
              avgClicksAfter: clickData.comparison.avgPageViewsAfter,
              changePercent: clickData.comparison.changePercent
            } : null
          };
        }
      } catch (err) {
        console.error('Error fetching click data:', err.message);
      }
    }
    
    return {
      trackingType: 'single-page',
      label: label || 'Analytics',
      pageFilter,
      ...analytics,
      ...(clicks && { clicks })
    };
  } catch (error) {
    console.error('Project analytics error:', error.message);
    return { error: error.message };
  }
}

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

/**
 * Get top pages to help debug filters
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

  // Build request - use search as itemIds filter if provided
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

  // Add search filter if provided (use CONTAINS clause format)
  if (searchTerm) {
    requestData.search = {
      clause: `CONTAINS '${searchTerm}'`
    };
  }

  const data = await apiRequest('/reports', {
    method: 'POST',
    data: requestData
  });

  // Return top pages with their pageviews
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
 * Find a specific page across multiple dimensions (page name, URL, etc.)
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

  // Try multiple dimensions to find the page
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
      // Some dimensions might not exist, skip them
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
 * List available report suites
 */
async function listReportSuites() {
  try {
    const data = await apiRequest('/collections/suites?limit=50');
    return data;
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Test authentication
 */
async function testAuth() {
  try {
    await getAccessToken();
    const companyId = await getGlobalCompanyId();
    return { success: true, globalCompanyId: companyId, reportSuiteId: ADOBE_REPORT_SUITE_ID };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get top click events to discover what's being tracked
 */
async function getTopClickEvents(searchTerm = null) {
  if (!ADOBE_REPORT_SUITE_ID) {
    throw new Error('ADOBE_REPORT_SUITE_ID is required');
  }

  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const startDate = thirtyDaysAgo.toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];

  const results = {};
  
  // Search across many eVars to find where event_detail is stored
  const clickDimensions = [];
  // Add evars 1-75
  for (let i = 1; i <= 75; i++) {
    clickDimensions.push(`variables/evar${i}`);
  }
  // Also add linkcustom
  clickDimensions.unshift('variables/linkcustom');

  // Only search if term provided (to avoid rate limiting)
  if (!searchTerm) {
    return {
      searchTerm: null,
      hint: 'Provide ?search=term to search across eVars (e.g., ?search=topeventsodds)'
    };
  }

  // Search in batches to avoid rate limiting
  for (const dimension of clickDimensions) {
    try {
      const requestData = {
        rsid: ADOBE_REPORT_SUITE_ID,
        globalFilters: [{
          type: 'dateRange',
          dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
        }],
        metricContainer: {
          metrics: [{ id: 'metrics/occurrences', columnId: '0' }]
        },
        dimension: dimension,
        search: { clause: `CONTAINS '${searchTerm}'` },
        settings: { countRepeatInstances: true, limit: 10 }
      };

      const data = await apiRequest('/reports', { method: 'POST', data: requestData });
      
      const items = (data?.rows || []).map(row => ({
        value: row.value,
        occurrences: row.data?.[0] || 0
      }));

      if (items.length > 0) {
        results[dimension] = items;
        // Found results, could stop here if you only need to find which eVar
      }
    } catch (err) {
      // Skip errors, continue searching
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return {
    searchTerm,
    dateRange: { start: startDate, end: endDate },
    results,
    hint: 'Look for "betting interaction" or similar event names to track clicks'
  };
}

/**
 * Get clicks on a specific page broken down by source/referring page
 */
async function getClicksBySource(clickPage) {
  if (!ADOBE_REPORT_SUITE_ID) {
    throw new Error('ADOBE_REPORT_SUITE_ID is required');
  }

  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const startDate = thirtyDaysAgo.toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];

  // First get the page itemId
  const pageSearch = await apiRequest('/reports', {
    method: 'POST',
    data: {
      rsid: ADOBE_REPORT_SUITE_ID,
      globalFilters: [{
        type: 'dateRange',
        dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
      }],
      metricContainer: {
        metrics: [{ id: 'metrics/pageviews', columnId: '0' }]
      },
      dimension: 'variables/page',
      search: { clause: `MATCH '${clickPage}'` },
      settings: { limit: 1 }
    }
  });

  const pageRow = pageSearch?.rows?.[0];
  if (!pageRow) {
    return { error: 'Page not found', clickPage };
  }

  const pageItemId = pageRow.itemId;
  const totalClicks = pageRow.data?.[0] || 0;

  // Try multiple source dimensions
  const sourceDimensions = ['variables/referringpagename', 'variables/previouspage', 'variables/entrypage'];
  let sources = [];
  
  for (const dim of sourceDimensions) {
    try {
      const sourceBreakdown = await apiRequest('/reports', {
        method: 'POST',
        data: {
          rsid: ADOBE_REPORT_SUITE_ID,
          globalFilters: [{
            type: 'dateRange',
            dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
          }],
          metricContainer: {
            metrics: [{
              id: 'metrics/pageviews',
              columnId: '0',
              filters: ['pageFilter']
            }],
            metricFilters: [{
              id: 'pageFilter',
              type: 'breakdown',
              dimension: 'variables/page',
              itemId: pageItemId
            }]
          },
          dimension: dim,
          settings: { limit: 30 }
        }
      });
      
      const dimSources = (sourceBreakdown?.rows || []).map(row => ({
        sourcePage: row.value,
        clicks: row.data?.[0] || 0,
        dimension: dim
      }));
      
      if (dimSources.length > 0) {
        sources = dimSources;
        break; // Found data, stop trying other dimensions
      }
    } catch (err) {
      // Continue to next dimension
    }
  }

  return {
    clickPage,
    totalClicks,
    sources,
    dateRange: { start: startDate, end: endDate }
  };
}

/**
 * Get bet clicks filtered by source page (using evar67 event_detail)
 * Searches for BOTH old tracking (espnbet) and new tracking (draft kings)
 * @param {string} launchDate - Launch date for before/after comparison
 * @param {string} pageToken - Page token to search for in evar67
 * @param {object} customDateRange - Optional { startDate, endDate } in YYYY-MM-DD format
 */
async function getOddsPageClicks(launchDate = null, pageToken = 'topeventsodds', customDateRange = null) {
  if (!ADOBE_REPORT_SUITE_ID) {
    throw new Error('ADOBE_REPORT_SUITE_ID is required');
  }

  let startDate, endDate;
  
  if (customDateRange) {
    startDate = customDateRange.startDate;
    endDate = customDateRange.endDate;
  } else {
    const today = new Date();
    const ninetyDaysAgo = new Date(today);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
    startDate = ninetyDaysAgo.toISOString().split('T')[0];
    endDate = today.toISOString().split('T')[0];
  }

  // Search for BOTH old (espnbet) and new (draft kings) tracking patterns
  // Both contain the pageToken (e.g., topeventsodds) in evar67
  const [espnBetData, draftKingsData] = await Promise.all([
    apiRequest('/reports', {
      method: 'POST',
      data: {
        rsid: ADOBE_REPORT_SUITE_ID,
        globalFilters: [{
          type: 'dateRange',
          dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
        }],
        metricContainer: {
          metrics: [{ id: 'metrics/occurrences', columnId: '0' }]
        },
        dimension: 'variables/evar67',
        search: { clause: `CONTAINS 'espnbet' AND CONTAINS '${pageToken}'` },
        settings: { countRepeatInstances: true, limit: 500 }
      }
    }),
    apiRequest('/reports', {
      method: 'POST',
      data: {
        rsid: ADOBE_REPORT_SUITE_ID,
        globalFilters: [{
          type: 'dateRange',
          dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
        }],
        metricContainer: {
          metrics: [{ id: 'metrics/occurrences', columnId: '0' }]
        },
        dimension: 'variables/evar67',
        search: { clause: `CONTAINS 'draft kings' AND CONTAINS '${pageToken}'` },
        settings: { countRepeatInstances: true, limit: 500 }
      }
    })
  ]);

  // Combine results from both searches
  const espnBetRows = espnBetData?.rows || [];
  const draftKingsRows = draftKingsData?.rows || [];
  
  const espnBetTotal = espnBetRows.reduce((sum, row) => sum + (row.data?.[0] || 0), 0);
  const draftKingsTotal = draftKingsRows.reduce((sum, row) => sum + (row.data?.[0] || 0), 0);
  const totalClicks = espnBetTotal + draftKingsTotal;
  
  // Collect itemIds from both
  const espnBetItemIds = espnBetRows.map(row => row.itemId);
  const draftKingsItemIds = draftKingsRows.map(row => row.itemId);
  
  // Get daily breakdown for each tracking type separately then merge
  let daily = [];
  
  const fetchDailyForItems = async (itemIds, label) => {
    if (itemIds.length === 0) return [];
    try {
      const dailyData = await apiRequest('/reports', {
        method: 'POST',
        data: {
          rsid: ADOBE_REPORT_SUITE_ID,
          globalFilters: [{
            type: 'dateRange',
            dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
          }],
          metricContainer: {
            metrics: [{
              id: 'metrics/occurrences',
              columnId: '0',
              filters: ['evarFilter']
            }],
            metricFilters: [{
              id: 'evarFilter',
              type: 'breakdown',
              dimension: 'variables/evar67',
              itemIds: itemIds.slice(0, 50)
            }]
          },
          dimension: 'variables/daterangeday',
          settings: { countRepeatInstances: true, limit: 400 }
        }
      });
      return (dailyData?.rows || []).map(row => ({
        date: row.value,
        clicks: row.data?.[0] || 0
      }));
    } catch (err) {
      console.error(`Error getting daily breakdown for ${label} (page: ${pageToken}):`, err.message);
      return [];
    }
  };
  
  const [espnBetDaily, draftKingsDaily] = await Promise.all([
    fetchDailyForItems(espnBetItemIds, 'espnbet'),
    fetchDailyForItems(draftKingsItemIds, 'draft kings')
  ]);
  
  // Merge daily data from both sources
  const dailyMap = {};
  [...espnBetDaily, ...draftKingsDaily].forEach(d => {
    if (!dailyMap[d.date]) {
      dailyMap[d.date] = { date: d.date, clicks: 0 };
    }
    dailyMap[d.date].clicks += d.clicks;
  });
  daily = Object.values(dailyMap).sort((a, b) => new Date(a.date) - new Date(b.date));

  // Calculate before/after if launch date provided
  let comparison = null;
  if (launchDate && daily.length > 0) {
    const launchDateObj = new Date(launchDate + 'T12:00:00');
    const beforeData = daily.filter(d => new Date(d.date) < launchDateObj);
    const afterData = daily.filter(d => new Date(d.date) >= launchDateObj);
    
    const avgBefore = beforeData.length > 0 
      ? beforeData.reduce((sum, d) => sum + d.clicks, 0) / beforeData.length 
      : 0;
    const avgAfter = afterData.length > 0 
      ? afterData.reduce((sum, d) => sum + d.clicks, 0) / afterData.length 
      : 0;
    
    comparison = {
      avgClicksBefore: Math.round(avgBefore),
      avgClicksAfter: Math.round(avgAfter),
      changePercent: avgBefore > 0 ? Math.round(((avgAfter - avgBefore) / avgBefore) * 100) : null,
      daysBefore: beforeData.length,
      daysAfter: afterData.length
    };
  }

  return {
    totalClicks,
    espnBetClicks: espnBetTotal,
    draftKingsClicks: draftKingsTotal,
    dailyClicks: daily,
    comparison,
    dateRange: { start: startDate, end: endDate },
    filter: `evar67 contains (espnbet OR draft kings) AND ${pageToken}`,
    itemCount: { espnBet: espnBetItemIds.length, draftKings: draftKingsItemIds.length }
  };
}

/**
 * Get ALL bet clicks grouped by page type (fast - only queries evar74)
 */
async function getAllBetClicksByPage() {
  if (!ADOBE_REPORT_SUITE_ID) {
    throw new Error('ADOBE_REPORT_SUITE_ID is required');
  }

  const today = new Date();
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  
  const startDate = ninetyDaysAgo.toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];

  // Query evar74 for BOTH betting interaction (new) and espn bet interaction (legacy)
  const [bettingData, espnBetData] = await Promise.all([
    apiRequest('/reports', {
      method: 'POST',
      data: {
        rsid: ADOBE_REPORT_SUITE_ID,
        globalFilters: [{
          type: 'dateRange',
          dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
        }],
        metricContainer: {
          metrics: [{ id: 'metrics/occurrences', columnId: '0' }]
        },
        dimension: 'variables/evar74',
        search: { clause: `BEGINS-WITH 'betting interaction'` },
        settings: { countRepeatInstances: true, limit: 500 }
      }
    }),
    apiRequest('/reports', {
      method: 'POST',
      data: {
        rsid: ADOBE_REPORT_SUITE_ID,
        globalFilters: [{
          type: 'dateRange',
          dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
        }],
        metricContainer: {
          metrics: [{ id: 'metrics/occurrences', columnId: '0' }]
        },
        dimension: 'variables/evar74',
        search: { clause: `BEGINS-WITH 'espn bet interaction'` },
        settings: { countRepeatInstances: true, limit: 500 }
      }
    })
  ]);
  
  // Combine rows from both queries
  const allRows = [...(bettingData?.rows || []), ...(espnBetData?.rows || [])];
  const data = { rows: allRows };

  // Group by page type
  const pageGroups = {};
  const pagePatterns = {
    'gamecast': /gamecast/i,
    'scoreboard': /scoreboard/i,
    'schedule': /schedule/i,
    'topeventsodds': /topeventsodds/i,
    ':odds': /:odds/i,
    ':scores': /:scores$/i,
    'index': /:index:/i,
    'home': /home|frontpage/i,
  };

  (data?.rows || []).forEach(row => {
    const value = row.value || '';
    const clicks = row.data?.[0] || 0;
    
    // Find which page type this belongs to
    let matched = false;
    for (const [pageType, pattern] of Object.entries(pagePatterns)) {
      if (pattern.test(value)) {
        if (!pageGroups[pageType]) {
          pageGroups[pageType] = { total: 0, samples: [] };
        }
        pageGroups[pageType].total += clicks;
        if (pageGroups[pageType].samples.length < 3) {
          pageGroups[pageType].samples.push(value);
        }
        matched = true;
        break;
      }
    }
    
    if (!matched && clicks > 1000) {
      if (!pageGroups['other']) {
        pageGroups['other'] = { total: 0, samples: [] };
      }
      pageGroups['other'].total += clicks;
      if (pageGroups['other'].samples.length < 5) {
        pageGroups['other'].samples.push({ value, clicks });
      }
    }
  });

  // Sort by total clicks
  const sorted = Object.entries(pageGroups)
    .map(([page, data]) => ({ page, ...data }))
    .sort((a, b) => b.total - a.total);

  return {
    pageGroups: sorted,
    dateRange: { start: startDate, end: endDate },
    totalRows: data?.rows?.length || 0
  };
}

/**
 * Get bet clicks broken down by actual page name (using segment + page dimension)
 */
async function getBetClicksByPageName() {
  if (!ADOBE_REPORT_SUITE_ID) {
    throw new Error('ADOBE_REPORT_SUITE_ID is required');
  }

  const today = new Date();
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  
  const startDate = ninetyDaysAgo.toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];

  // Use evar74 which has page context: "betting interaction:scoreboard:draft kings" etc
  // Parse out the page type from position 2 (after event name and sometimes partner)
  const data = await apiRequest('/reports', {
    method: 'POST',
    data: {
      rsid: ADOBE_REPORT_SUITE_ID,
      globalFilters: [{
        type: 'dateRange',
        dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
      }],
      metricContainer: {
        metrics: [{ id: 'metrics/occurrences', columnId: '0' }]
      },
      dimension: 'variables/evar74',
      search: { clause: `BEGINS-WITH 'betting interaction' OR BEGINS-WITH 'espn bet interaction'` },
      settings: { countRepeatInstances: true, limit: 1000 }
    }
  });
  
  // Parse exact page names from the evar74 values
  // Formats:
  //   "betting interaction:scoreboard:draft kings" -> scoreboard
  //   "betting interaction:draft kings:football:game:gamecast:see-more-on-draft kings" -> football:game:gamecast
  //   "betting interaction:draft kings:espn:nfl:odds:total:o42.5" -> espn:nfl:odds
  //   "espn bet interaction:::espnbet:espn:nfl:schedule:total:44.5:espn:nfl:schedule:" -> espn:nfl:schedule
  const pageClicks = {};
  const rawExamples = {}; // Store examples for each page
  
  (data?.rows || []).forEach(row => {
    const value = row.value || '';
    const clicks = row.data?.[0] || 0;
    
    let pageName = null;
    
    // Pattern 1: ESPN Bet legacy - page name appears at end like "espn:nfl:schedule:"
    // Format: "espn bet interaction:::...:espn:SPORT:PAGETYPE:"
    const espnBetMatch = value.match(/:espn:([a-z]+):([a-z]+):?$/i);
    if (espnBetMatch) {
      pageName = `espn:${espnBetMatch[1]}:${espnBetMatch[2]}`;
    }
    
    // Pattern 2: DraftKings - "betting interaction:draft kings:espn:SPORT:PAGETYPE:action"
    if (!pageName) {
      const dkMatch = value.match(/draft kings:espn:([a-z]+):([a-z:]+?):(total|moneyline|pointspread|see-more|success)/i);
      if (dkMatch) {
        pageName = `espn:${dkMatch[1]}:${dkMatch[2]}`;
      }
    }
    
    // Pattern 3: DraftKings with sport but no espn prefix - "draft kings:football:game:gamecast:see-more"
    if (!pageName) {
      const sportMatch = value.match(/draft kings:(football|basketball|hockey|baseball|soccer):([a-z:]+?):(see-more|success)/i);
      if (sportMatch) {
        // Map sport names to ESPN codes
        const sportMap = { football: 'nfl', basketball: 'nba', hockey: 'nhl', baseball: 'mlb', soccer: 'soccer' };
        const espnSport = sportMap[sportMatch[1].toLowerCase()] || sportMatch[1];
        pageName = `espn:${espnSport}:${sportMatch[2]}`;
      }
    }
    
    // Pattern 4: Simple format - "betting interaction:scoreboard:draft kings"
    if (!pageName) {
      const simpleMatch = value.match(/betting interaction:([a-z]+):(draft kings|success)/i);
      if (simpleMatch) {
        pageName = simpleMatch[1];
      }
    }
    
    // Pattern 5: Watch ESPN / Home pages
    if (!pageName && value.includes('watchespn:home')) {
      pageName = 'watchespn:home';
    }
    
    // Fallback
    if (!pageName) {
      pageName = 'other';
    }
    
    // Clean up page name
    pageName = pageName.replace(/:+$/, '').replace(/^:+/, '');
    
    if (!pageClicks[pageName]) {
      pageClicks[pageName] = 0;
      rawExamples[pageName] = [];
    }
    pageClicks[pageName] += clicks;
    if (rawExamples[pageName].length < 2) {
      rawExamples[pageName].push(value);
    }
  });

  // Convert to sorted array with examples
  const pages = Object.entries(pageClicks)
    .map(([page, clicks]) => ({ 
      page, 
      clicks,
      examples: rawExamples[page] || []
    }))
    .sort((a, b) => b.clicks - a.clicks);

  return {
    pages,
    totalPages: pages.length,
    totalClicks: pages.reduce((sum, p) => sum + p.clicks, 0),
    dateRange: { start: startDate, end: endDate },
    rawRows: data?.rows?.length || 0
  };
}

/**
 * Get ALL bet clicks grouped by source page using evar66 (event_name)
 * evar66 contains values like "betting interaction", "espn bet interaction"
 * This auto-discovers all pages with bet clicks - no manual filter config needed
 */
async function getBetClicksBySourcePage(launchDate = null) {
  if (!ADOBE_REPORT_SUITE_ID) {
    throw new Error('ADOBE_REPORT_SUITE_ID is required');
  }

  const cacheKey = `bet-clicks-by-page:${launchDate || 'all'}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const today = new Date();
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  
  const startDate = ninetyDaysAgo.toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];

  // Query for bet clicks (evar66 = event_name) broken down by page
  // Using segment to filter by evar66 values, then break down by pageName
  const betEventNames = [
    'betting interaction',
    'espn bet interaction', 
    'bet interaction',
    'betting ui interaction'
  ];

  // Get all bet clicks grouped by page
  const data = await apiRequest('/reports', {
    method: 'POST',
    data: {
      rsid: ADOBE_REPORT_SUITE_ID,
      globalFilters: [{
        type: 'dateRange',
        dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
      }],
      metricContainer: {
        metrics: [{ id: 'metrics/occurrences', columnId: '0' }]
      },
      dimension: 'variables/page',
      search: {
        // First filter to only bet click events via evar66
        clause: betEventNames.map(e => `'${e}'`).join(' OR ')
      },
      settings: { countRepeatInstances: true, limit: 1000 }
    }
  });

  // That search won't work on evar66 when dimension is page
  // We need a different approach: use segment or breakdown
  
  // Alternative: Query evar66 for bet events, get the page from cross-dimension
  // For now, let's query each bet event type and aggregate
  
  const results = {};
  
  for (const eventName of ['betting interaction', 'espn bet interaction']) {
    try {
      // Get pages where this bet event occurred
      const pageData = await apiRequest('/reports', {
        method: 'POST', 
        data: {
          rsid: ADOBE_REPORT_SUITE_ID,
          globalFilters: [{
            type: 'dateRange',
            dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
          }],
          metricContainer: {
            metrics: [{ id: 'metrics/occurrences', columnId: '0' }],
            metricFilters: [{
              id: 'betFilter',
              type: 'breakdown',
              dimension: 'variables/evar66',
              itemId: eventName
            }]
          },
          dimension: 'variables/page',
          settings: { countRepeatInstances: true, limit: 500 }
        }
      });

      // Aggregate results
      (pageData?.rows || []).forEach(row => {
        const pageName = row.value;
        const clicks = row.data?.[0] || 0;
        if (clicks > 0) {
          results[pageName] = (results[pageName] || 0) + clicks;
        }
      });
    } catch (err) {
      console.log(`Error fetching ${eventName}:`, err.message);
      
      // Fallback: search evar67 for the event name pattern and extract page
      try {
        const fallbackData = await apiRequest('/reports', {
          method: 'POST',
          data: {
            rsid: ADOBE_REPORT_SUITE_ID,
            globalFilters: [{
              type: 'dateRange', 
              dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
            }],
            metricContainer: {
              metrics: [{ id: 'metrics/occurrences', columnId: '0' }]
            },
            dimension: 'variables/evar67',
            search: { clause: `CONTAINS '${eventName}'` },
            settings: { countRepeatInstances: true, limit: 1000 }
          }
        });

        // Parse page context from evar67 values
        (fallbackData?.rows || []).forEach(row => {
          const value = row.value || '';
          const clicks = row.data?.[0] || 0;
          
          // Extract page pattern from evar67
          // Format: "draft kings:espn:nfl:game:gamecast:pointSpread:..."
          // or: "espn bet interaction:::espnbet:espn:nfl:schedule:..."
          let pageName = null;
          
          // Try to extract espn:sport:pagetype pattern
          const pageMatch = value.match(/espn:([a-z]+):([a-z:]+?)(?::|$)/i);
          if (pageMatch) {
            pageName = `espn:${pageMatch[1]}:${pageMatch[2].split(':')[0]}`;
          }
          
          if (pageName && clicks > 0) {
            results[pageName] = (results[pageName] || 0) + clicks;
          }
        });
      } catch (fallbackErr) {
        console.log(`Fallback also failed for ${eventName}:`, fallbackErr.message);
      }
    }
    
    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 200));
  }

  // Convert to sorted array
  const pages = Object.entries(results)
    .map(([page, clicks]) => ({ page, clicks }))
    .filter(p => p.clicks >= 100) // Only pages with significant clicks
    .sort((a, b) => b.clicks - a.clicks);

  // Calculate before/after launch if provided
  let pagesWithComparison = pages;
  if (launchDate) {
    // For each page, we'd need daily breakdown - too expensive for all pages
    // Just return totals for now, daily breakdown can be fetched per-page
    pagesWithComparison = pages.map(p => ({
      ...p,
      launchDate
    }));
  }

  const result = {
    pages: pagesWithComparison,
    totalPages: pages.length,
    totalClicks: pages.reduce((sum, p) => sum + p.clicks, 0),
    dateRange: { start: startDate, end: endDate },
    launchDate,
    method: 'evar66 (event_name) grouped by page'
  };

  cache.set(cacheKey, result, 600); // Cache for 10 minutes
  return result;
}

/**
 * Get daily bet clicks for a specific page (for chart)
 * @param {string} pageName - Page to query (e.g., "espn:mlb:game:gamecast")
 * @param {string|null} launchDate - Optional launch date for comparison
 * @param {object|null} customDateRange - Optional { startDate, endDate } in YYYY-MM-DD format
 */
async function getPageDailyBetClicks(pageName, launchDate = null, customDateRange = null) {
  if (!ADOBE_REPORT_SUITE_ID) {
    throw new Error('ADOBE_REPORT_SUITE_ID is required');
  }

  // Use custom date range or default to 90 days
  let startDate, endDate;
  if (customDateRange?.startDate && customDateRange?.endDate) {
    startDate = customDateRange.startDate;
    endDate = customDateRange.endDate;
  } else {
  const today = new Date();
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    startDate = ninetyDaysAgo.toISOString().split('T')[0];
    endDate = today.toISOString().split('T')[0];
  }

  const cacheKey = `page-daily-clicks:${pageName}:${startDate}:${endDate}:${launchDate || 'all'}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  console.log(`  Getting daily clicks for ${pageName} using matrix approach...`);
  
  let dailyClicks = {};
  let totalClicks = 0;
  
  try {
    // Step 1: Get day itemIds
    const daysResponse = await apiRequest('/reports', {
      method: 'POST',
      data: {
        rsid: ADOBE_REPORT_SUITE_ID,
        globalFilters: [
          { type: 'segment', segmentId: ALL_BET_CLICKS_SEGMENT_ID },
          { type: 'dateRange', dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999` }
        ],
        metricContainer: {
          metrics: [{ columnId: '0', id: 'metrics/occurrences' }]
        },
        dimension: 'variables/daterangeday',
        settings: { countRepeatInstances: true, limit: 400, dimensionSort: 'asc' }
      }
    });
    
    const days = (daysResponse?.rows || []).map(row => {
      const parsed = new Date(row.value);
      return {
        itemId: row.itemId,
        isoDate: !isNaN(parsed) ? parsed.toISOString().split('T')[0] : row.value
      };
    });
    
    // Step 2: Build matrix query for this specific page
    const metrics = days.map((day, idx) => ({
      columnId: String(idx),
      id: 'metrics/occurrences',
      filters: [String(idx)]
    }));
    
    const metricFilters = days.map((day, idx) => ({
      id: String(idx),
      type: 'breakdown',
      dimension: 'variables/daterangeday',
      itemId: day.itemId
    }));
    
    const matrixResponse = await apiRequest('/reports', {
        method: 'POST',
        data: {
          rsid: ADOBE_REPORT_SUITE_ID,
        globalFilters: [
          { type: 'segment', segmentId: ALL_BET_CLICKS_SEGMENT_ID },
          { type: 'dateRange', dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999` }
        ],
        metricContainer: { metrics, metricFilters },
        dimension: 'variables/evar13',
        search: { clause: `MATCH '${pageName}'` },
        settings: { countRepeatInstances: true, limit: 10 }
      }
    });
    
    // Find this page in the results
    const pageRow = matrixResponse?.rows?.find(r => r.value === pageName);
    
    if (pageRow) {
      (pageRow.data || []).forEach((clicks, idx) => {
        if (idx < days.length && clicks > 0) {
          dailyClicks[days[idx].isoDate] = clicks;
          totalClicks += clicks;
        }
      });
      console.log(`  Got exact daily data: ${totalClicks} total clicks across ${Object.keys(dailyClicks).length} days`);
    }
    } catch (err) {
    console.log(`  Error getting data for ${pageName}:`, err.message);
  }

  // Calculate before/after comparison
  let comparison = null;
  if (launchDate && Object.keys(dailyClicks).length > 0) {
    const launchDateNoon = new Date(launchDate + 'T12:00:00');
    let beforeTotal = 0, afterTotal = 0;
    let beforeDays = 0, afterDays = 0;

    Object.entries(dailyClicks).forEach(([date, clicks]) => {
      const dateObj = new Date(date + 'T12:00:00');
      if (dateObj < launchDateNoon) {
        beforeTotal += clicks;
        beforeDays++;
      } else {
        afterTotal += clicks;
        afterDays++;
      }
    });

    const avgBefore = beforeDays > 0 ? Math.round(beforeTotal / beforeDays) : 0;
    const avgAfter = afterDays > 0 ? Math.round(afterTotal / afterDays) : 0;
    const changePercent = avgBefore > 0 
      ? Math.round(((avgAfter - avgBefore) / avgBefore) * 100)
      : (avgAfter > 0 ? 100 : 0);

    comparison = {
      avgClicksBefore: avgBefore,
      avgClicksAfter: avgAfter,
      daysBefore: beforeDays,
      daysAfter: afterDays,
      changePercent
    };
  }

  const result = {
    page: pageName,
    totalClicks,
    dailyClicks,
    comparison,
    dateRange: { start: startDate, end: endDate },
    method: 'multi-column-matrix',
    hasExactDailyData: true
  };

  cache.set(cacheKey, result, 300);
  return result;
}

// Track in-progress discovery to prevent duplicate concurrent calls
let discoveryInProgress = null;

/**
 * Get ALL bet clicks using the "All Bet Clicks" segment
 * Then break down by PageName (evar13) to see where clicks came from
 * This auto-discovers all pages - no manual config needed!
 */
async function discoverAllBetClicks(launchDate = '2025-12-01', customDateRange = null) {
  if (!ADOBE_REPORT_SUITE_ID) {
    throw new Error('ADOBE_REPORT_SUITE_ID is required');
  }

  // Calculate date range
  let startDate, endDate;
  if (customDateRange) {
    startDate = customDateRange.startDate;
    endDate = customDateRange.endDate;
  } else {
    const today = new Date();
    const ninetyDaysAgo = new Date(today);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    startDate = ninetyDaysAgo.toISOString().split('T')[0];
    endDate = today.toISOString().split('T')[0];
  }

  const cacheKey = `discover-bet-clicks-v2:${launchDate}:${startDate}:${endDate}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // If discovery is already in progress, wait for it
  if (discoveryInProgress) {
    console.log('  → Discovery already in progress, waiting...');
    return discoveryInProgress;
  }

  console.log(`Discovering all bet clicks by page using segment (${startDate} to ${endDate})...`);
  
  // Mark discovery as in progress
  discoveryInProgress = (async () => {
    try {
      return await _doDiscoveryWithSegment(launchDate, startDate, endDate, cacheKey);
    } finally {
      discoveryInProgress = null;
    }
  })();
  
  return discoveryInProgress;
}

/**
 * New multi-column matrix discovery - exact daily data for ALL pages in 2 API calls!
 */
async function _doDiscoveryWithSegment(launchDate, startDate, endDate, cacheKey) {
  const discoveryStartTime = Date.now();
  
  console.log('  → Step 1: Getting day itemIds...');
  
  // Step 1: Get all days with their itemIds (required for time dimension filters)
  const daysResponse = await apiRequest('/reports', {
    method: 'POST',
    data: {
      rsid: ADOBE_REPORT_SUITE_ID,
      globalFilters: [
        { type: 'segment', segmentId: ALL_BET_CLICKS_SEGMENT_ID },
        { type: 'dateRange', dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999` }
      ],
      metricContainer: {
        metrics: [{ columnId: '0', id: 'metrics/occurrences' }]
      },
      dimension: 'variables/daterangeday',
      settings: { countRepeatInstances: true, limit: 400, dimensionSort: 'asc' }
    }
  });
  
  const days = (daysResponse?.rows || []).map(row => {
    const parsed = new Date(row.value);
    return {
      itemId: row.itemId,
      value: row.value,
      isoDate: !isNaN(parsed) ? parsed.toISOString().split('T')[0] : row.value,
      totalClicks: row.data?.[0] || 0
    };
  });
  
  console.log(`  → Got ${days.length} days with itemIds`);
  
  // Step 2: Split into batches and make matrix queries
  // Using 45 days per batch with 90s timeout for reliability
  const BATCH_SIZE = 45;
  const MATRIX_TIMEOUT = 90000; // 90 seconds for matrix queries
  const numBatches = Math.ceil(days.length / BATCH_SIZE);
  console.log(`  → Step 2: Building Page × Day matrix for ${days.length} days in ${numBatches} batch(es) (${BATCH_SIZE} days/batch, ${MATRIX_TIMEOUT/1000}s timeout)...`);
  
  // Collect all page data across batches
  const pageDataMap = {}; // pageName -> { dailyClicks, totalClicks, ... }
  let apiCallCount = 1; // Already made 1 call for day itemIds
  
  for (let batchIdx = 0; batchIdx < numBatches; batchIdx++) {
    const batchStart = batchIdx * BATCH_SIZE;
    const batchDays = days.slice(batchStart, batchStart + BATCH_SIZE);
    
    console.log(`    Batch ${batchIdx + 1}/${numBatches}: ${batchDays.length} days (${batchDays[0].isoDate} to ${batchDays[batchDays.length-1].isoDate})`);
    
    const metrics = batchDays.map((day, idx) => ({
      columnId: String(idx),
      id: 'metrics/occurrences',
      filters: [String(idx)]
    }));
    
    const metricFilters = batchDays.map((day, idx) => ({
      id: String(idx),
      type: 'breakdown',
      dimension: 'variables/daterangeday',
      itemId: day.itemId
    }));
    
    const matrixResponse = await apiRequest('/reports', {
      method: 'POST',
      timeout: MATRIX_TIMEOUT,
      data: {
        rsid: ADOBE_REPORT_SUITE_ID,
        globalFilters: [
          { type: 'segment', segmentId: ALL_BET_CLICKS_SEGMENT_ID },
          { type: 'dateRange', dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999` }
        ],
        metricContainer: {
          metrics,
          metricFilters
        },
        dimension: 'variables/evar13', // PageName
        settings: {
          countRepeatInstances: true,
          limit: 200 // Top 200 pages per batch to ensure we catch all leagues
        }
      }
    });
    apiCallCount++;
    
    const batchDateLabels = batchDays.map(d => d.isoDate);
    
    // Merge batch results into pageDataMap
    (matrixResponse?.rows || []).forEach(row => {
      const pageName = row.value || '';
      if (!pageName) return;
      
      if (!pageDataMap[pageName]) {
        pageDataMap[pageName] = {
          page: pageName,
          label: formatPageLabel(pageName),
          league: extractLeagueFromPage(pageName),
          pageType: extractPageTypeFromPageName(pageName),
          isInterstitial: pageName.toLowerCase().includes('interstitial'),
          dailyClicks: {},
          totalClicks: 0
        };
      }
      
      // Add this batch's daily data
      (row.data || []).forEach((clicks, idx) => {
        if (idx < batchDateLabels.length && clicks > 0) {
          const date = batchDateLabels[idx];
          pageDataMap[pageName].dailyClicks[date] = { clicks };
          pageDataMap[pageName].totalClicks += clicks;
        }
      });
    });
    
    console.log(`    → Got ${matrixResponse?.rows?.length || 0} pages in batch ${batchIdx + 1}`);
    
    // Small delay between batches to be nice to the API
    if (batchIdx < numBatches - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  console.log(`  → Merged data from ${numBatches} batches, ${Object.keys(pageDataMap).length} unique pages`);
  
  // Step 3: Calculate comparisons and finalize page objects
  const launchDateObj = new Date(launchDate + 'T12:00:00');
  
  const pages = Object.values(pageDataMap).map(page => {
    let beforeTotal = 0, beforeDays = 0;
    let afterTotal = 0, afterDays = 0;
    
    Object.entries(page.dailyClicks).forEach(([date, data]) => {
      const dateObj = new Date(date + 'T12:00:00');
      if (dateObj < launchDateObj) {
        beforeTotal += data.clicks;
        beforeDays++;
      } else {
        afterTotal += data.clicks;
        afterDays++;
      }
    });
    
    const avgClicksBefore = beforeDays > 0 ? Math.round(beforeTotal / beforeDays) : 0;
    const avgClicksAfter = afterDays > 0 ? Math.round(afterTotal / afterDays) : 0;
    
    // Calculate changePercent with proper edge case handling
    let changePercent = null;
    if (avgClicksBefore > 0) {
      changePercent = Math.round(((avgClicksAfter - avgClicksBefore) / avgClicksBefore) * 100);
    } else if (avgClicksAfter > 0) {
      changePercent = 100; // From 0 to something = 100% increase
    }
    // If both are 0, changePercent stays null (can't calculate)
    
    return {
      ...page,
      clicks: page.totalClicks,
      hasExactDailyData: true,
      comparison: {
        avgClicksBefore,
        avgClicksAfter,
        beforeDays,
        afterDays,
        changePercent
      }
    };
  }).filter(p => p.clicks > 0);
  
  // Calculate totals
  const totalClicks = pages.reduce((sum, p) => sum + p.clicks, 0);
  const interstitialClicks = pages.filter(p => p.isInterstitial).reduce((sum, p) => sum + p.clicks, 0);
  const engagementClicks = totalClicks - interstitialClicks;

  // Group by league (excluding interstitials)
  const byLeague = {};
  pages.filter(p => !p.isInterstitial).forEach(p => {
    const league = p.league || 'Other';
    if (!byLeague[league]) {
      byLeague[league] = { league, totalClicks: 0, pages: [] };
    }
    byLeague[league].totalClicks += p.clicks;
    byLeague[league].pages.push(p);
  });

  // Group by page type
  const byPageType = {};
  pages.forEach(p => {
    const pageType = p.pageType || 'other';
    if (!byPageType[pageType]) {
      byPageType[pageType] = { pageType, totalClicks: 0, pages: [] };
    }
    byPageType[pageType].totalClicks += p.clicks;
    byPageType[pageType].pages.push(p);
  });

  console.log(`  → Found ${pages.length} pages with ${totalClicks} total bet clicks`);
  console.log(`  → Engagement clicks (excl. interstitial): ${engagementClicks}`);
  
  // Sort by clicks descending, then take top 50 (excluding interstitials)
  const sortedPages = pages.sort((a, b) => b.clicks - a.clicks);
  const topPages = sortedPages.filter(p => !p.isInterstitial).slice(0, 50);
    
  const dateLabels = days.map(d => d.isoDate);
  
  const result = {
    pages: topPages,
    totalPages: pages.length,
    totalClicks,
    interstitialClicks,
    engagementClicks,
    confirmationRate: totalClicks > 0 ? ((interstitialClicks / totalClicks) * 100).toFixed(1) + '%' : '0%',
    byLeague: Object.values(byLeague).sort((a, b) => b.totalClicks - a.totalClicks),
    byPageType: Object.values(byPageType).sort((a, b) => b.totalClicks - a.totalClicks),
    dateRange: { start: startDate, end: endDate },
    dates: dateLabels,
    method: `multi-column-matrix (${apiCallCount} API calls, ${numBatches} batch${numBatches > 1 ? 'es' : ''})`,
    segmentId: ALL_BET_CLICKS_SEGMENT_ID,
    dailyDataInfo: {
      pagesWithExactData: topPages.length,
      pagesWithProportionalData: 0,
      note: `All pages have exact daily data from ${numBatches} matrix batch(es)`
    },
    timing: {
      totalMs: Date.now() - discoveryStartTime,
      apiCalls: apiCallCount,
      batches: numBatches,
      daysPerBatch: BATCH_SIZE,
      pagesWithDailyData: topPages.filter(p => Object.keys(p.dailyClicks || {}).length > 0).length
    }
  };

  // Cache for 5 minutes
  cache.set(cacheKey, result, 300);
  
  console.log(`  → Discovery complete in ${result.timing.totalMs}ms (${apiCallCount} API calls, ${numBatches} batch${numBatches > 1 ? 'es' : ''})`);
  
  return result;
}


// Format page name to friendly label
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
 * Get ALL attributes/dimensions for bet click events
 * This helps discover what data is available alongside bet clicks
 */
async function exploreBetClickAttributes() {
  if (!ADOBE_REPORT_SUITE_ID) {
    throw new Error('ADOBE_REPORT_SUITE_ID is required');
  }

  const today = new Date();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const startDate = sevenDaysAgo.toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];

  // List of dimensions to check for bet click events
  // Including more evars/props to find c.league, c.sport, c.pageDetail mappings
  const dimensions = [
    { id: 'variables/page', name: 'Page Name' },
    { id: 'variables/pagename', name: 'Page Name (alt)' },
    { id: 'variables/evar67', name: 'evar67 (event_detail)' },
    { id: 'variables/evar74', name: 'evar74 (interaction)' },
    { id: 'variables/sitesection', name: 'Site Section' },
    { id: 'variables/channel', name: 'Channel' },
    { id: 'variables/server', name: 'Server' },
    // Props 1-10
    { id: 'variables/prop1', name: 'prop1' },
    { id: 'variables/prop2', name: 'prop2' },
    { id: 'variables/prop3', name: 'prop3' },
    { id: 'variables/prop4', name: 'prop4' },
    { id: 'variables/prop5', name: 'prop5' },
    { id: 'variables/prop6', name: 'prop6' },
    { id: 'variables/prop7', name: 'prop7' },
    { id: 'variables/prop8', name: 'prop8' },
    { id: 'variables/prop9', name: 'prop9' },
    { id: 'variables/prop10', name: 'prop10' },
    // Evars 1-20 (c.league, c.sport might map here)
    { id: 'variables/evar1', name: 'evar1' },
    { id: 'variables/evar2', name: 'evar2' },
    { id: 'variables/evar3', name: 'evar3' },
    { id: 'variables/evar4', name: 'evar4' },
    { id: 'variables/evar5', name: 'evar5' },
    { id: 'variables/evar6', name: 'evar6' },
    { id: 'variables/evar7', name: 'evar7' },
    { id: 'variables/evar8', name: 'evar8' },
    { id: 'variables/evar9', name: 'evar9' },
    { id: 'variables/evar10', name: 'evar10' },
    { id: 'variables/evar11', name: 'evar11' },
    { id: 'variables/evar12', name: 'evar12' },
    { id: 'variables/evar13', name: 'evar13' },
    { id: 'variables/evar14', name: 'evar14' },
    { id: 'variables/evar15', name: 'evar15' },
    { id: 'variables/evar16', name: 'evar16' },
    { id: 'variables/evar17', name: 'evar17' },
    { id: 'variables/evar18', name: 'evar18' },
    { id: 'variables/evar19', name: 'evar19' },
    { id: 'variables/evar20', name: 'evar20' },
    // Other useful dimensions
    { id: 'variables/referringdomain', name: 'Referring Domain' },
    { id: 'variables/geocountry', name: 'Country' },
    { id: 'variables/mobiledevicetype', name: 'Device Type' },
  ];

  const results = {};

  // First, get a sample bet click event ID to use for breakdown
  console.log('Fetching sample bet click event...');
  const betClickSample = await apiRequest('/reports', {
      method: 'POST',
      data: {
        rsid: ADOBE_REPORT_SUITE_ID,
        globalFilters: [{
          type: 'dateRange',
          dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
        }],
        metricContainer: {
          metrics: [{ id: 'metrics/occurrences', columnId: '0' }]
        },
        dimension: 'variables/evar67',
        search: { clause: `CONTAINS 'draft kings'` },
      settings: { countRepeatInstances: true, limit: 1 }
    }
  });

  const sampleEvent = betClickSample?.rows?.[0];
  const sampleEvar67 = sampleEvent?.value || 'No sample found';
  const sampleClicks = sampleEvent?.data?.[0] || 0;

  // Query each dimension with bet click filter
  for (const dim of dimensions) {
    try {
      console.log(`Checking ${dim.name}...`);
      const data = await apiRequest('/reports', {
      method: 'POST',
      data: {
        rsid: ADOBE_REPORT_SUITE_ID,
        globalFilters: [{
          type: 'dateRange',
          dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
        }],
        metricContainer: {
          metrics: [{ id: 'metrics/occurrences', columnId: '0' }]
        },
          dimension: dim.id,
          search: { clause: `CONTAINS 'draft kings' OR CONTAINS 'espnbet' OR CONTAINS 'gamecast' OR CONTAINS 'scoreboard' OR CONTAINS 'betting'` },
          settings: { countRepeatInstances: true, limit: 10 }
        }
      });

      results[dim.name] = {
        dimension: dim.id,
        topValues: (data?.rows || []).map(r => ({
          value: r.value,
          clicks: r.data?.[0] || 0
        }))
      };

      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      results[dim.name] = { dimension: dim.id, error: err.message };
    }
  }

  return {
    dateRange: { start: startDate, end: endDate },
    sampleBetClick: {
      evar67: sampleEvar67,
      clicks: sampleClicks
    },
    dimensions: results,
    hint: 'Look for dimensions that have page-related values with reasonable click counts (not total site traffic)'
  };
}

/**
 * Explore correlation between ambiguous evar67 values and evar3 (league info)
 * This helps determine if we can use evar3 to disambiguate sports like "football" vs "basketball"
 */
async function exploreEvar67LeagueCorrelation() {
  if (!ADOBE_REPORT_SUITE_ID) {
    throw new Error('ADOBE_REPORT_SUITE_ID is required');
  }

  const today = new Date();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const startDate = sevenDaysAgo.toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];

  // Ambiguous evar67 patterns we want to investigate
  const ambiguousPatterns = [
    { search: `CONTAINS 'football:game:gamecast'`, label: 'Football Gamecast' },
    { search: `CONTAINS 'basketball:game:gamecast'`, label: 'Basketball Gamecast' },
    { search: `CONTAINS 'scoreboard:draft kings'`, label: 'Scoreboard (no sport)' },
    { search: `CONTAINS 'cricket-gamecast'`, label: 'Cricket Gamecast' }
  ];
  
  // Sport/League dimension mappings (from Adobe Analytics config)
  const SPORT_VAR = 'variables/evar19';  // c.sport
  const LEAGUE_VAR = 'variables/evar21'; // c.league

  const results = [];

  for (const pattern of ambiguousPatterns) {
    try {
      console.log(`Checking ${pattern.label}...`);
      
      // Step 1: Get bet clicks matching this ambiguous pattern
      const evar67Data = await apiRequest('/reports', {
      method: 'POST',
      data: {
        rsid: ADOBE_REPORT_SUITE_ID,
        globalFilters: [{
          type: 'dateRange',
          dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
        }],
        metricContainer: {
          metrics: [{ id: 'metrics/occurrences', columnId: '0' }]
        },
        dimension: 'variables/evar67',
          search: { clause: pattern.search },
          settings: { countRepeatInstances: true, limit: 5 }
        }
      });

      const matchingEvar67s = (evar67Data?.rows || []).map(r => ({
        value: r.value,
        clicks: r.data?.[0] || 0,
        itemId: r.itemId
      }));

      if (matchingEvar67s.length === 0) {
        results.push({
          pattern: pattern.label,
          searchClause: pattern.search,
          message: 'No matching bet clicks found',
          evar3Breakdown: []
        });
        continue;
      }

      // Step 2: For each matching evar67, break down by evar19 (sport) and evar21 (league)
      const breakdowns = [];
      for (const evar67Item of matchingEvar67s.slice(0, 3)) {
        try {
          // Get Sport values (evar19) for this bet click
          const sportBreakdown = await apiRequest('/reports', {
            method: 'POST',
            data: {
              rsid: ADOBE_REPORT_SUITE_ID,
              globalFilters: [
                {
                  type: 'dateRange',
                  dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
                }
              ],
              metricContainer: {
                metrics: [{ id: 'metrics/occurrences', columnId: '0' }],
                metricFilters: [{
                  id: 'evar67-filter',
                  type: 'breakdown',
                  dimension: 'variables/evar67',
                  itemId: evar67Item.itemId
                }]
              },
              dimension: SPORT_VAR,
              settings: { countRepeatInstances: true, limit: 10 }
            }
          });

          const sportValues = (sportBreakdown?.rows || []).map(r => ({
            sport: r.value,
            clicks: r.data?.[0] || 0
          })).filter(v => v.clicks > 0 && v.sport !== 'Unspecified');

          // Get League values (evar21) for this bet click
          const leagueBreakdown = await apiRequest('/reports', {
            method: 'POST',
            data: {
              rsid: ADOBE_REPORT_SUITE_ID,
              globalFilters: [
                {
                  type: 'dateRange',
                  dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
                }
              ],
              metricContainer: {
                metrics: [{ id: 'metrics/occurrences', columnId: '0' }],
                metricFilters: [{
                  id: 'evar67-filter',
                  type: 'breakdown',
                  dimension: 'variables/evar67',
                  itemId: evar67Item.itemId
                }]
              },
              dimension: LEAGUE_VAR,
              settings: { countRepeatInstances: true, limit: 10 }
            }
          });

          const leagueValues = (leagueBreakdown?.rows || []).map(r => ({
            league: r.value,
            clicks: r.data?.[0] || 0
          })).filter(v => v.clicks > 0 && v.league !== 'Unspecified');

          // Also check variables/page for context
          const pageBreakdown = await apiRequest('/reports', {
            method: 'POST',
            data: {
              rsid: ADOBE_REPORT_SUITE_ID,
              globalFilters: [
                {
                  type: 'dateRange',
                  dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
                }
              ],
              metricContainer: {
                metrics: [{ id: 'metrics/occurrences', columnId: '0' }],
                metricFilters: [{
                  id: 'evar67-filter',
                  type: 'breakdown',
                  dimension: 'variables/evar67',
                  itemId: evar67Item.itemId
                }]
              },
              dimension: 'variables/page',
              settings: { countRepeatInstances: true, limit: 5 }
            }
          });

          const pageValues = (pageBreakdown?.rows || []).map(r => ({
            page: r.value,
            clicks: r.data?.[0] || 0
          })).filter(v => v.clicks > 0);

          breakdowns.push({
            evar67: evar67Item.value,
            totalClicks: evar67Item.clicks,
            sportValues,
            leagueValues,
            pageValues,
            inferredLeague: inferLeagueFromSportLeague(sportValues, leagueValues, evar67Item.value)
          });

          await new Promise(r => setTimeout(r, 100));
        } catch (err) {
          breakdowns.push({
            evar67: evar67Item.value,
            error: err.message
          });
        }
      }

      results.push({
        pattern: pattern.label,
        searchClause: pattern.search,
        totalMatchingClicks: matchingEvar67s.reduce((sum, v) => sum + v.clicks, 0),
        breakdowns
      });

      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      results.push({
        pattern: pattern.label,
        error: err.message
      });
    }
  }

  return {
    dateRange: { start: startDate, end: endDate },
    analysis: results,
    variableMappings: {
      sport: 'evar19 (c.sport)',
      league: 'evar21 (c.league)'
    },
    summary: {
      canUseSport: results.some(r => r.breakdowns?.some(b => b.sportValues?.length > 0)),
      canUseLeague: results.some(r => r.breakdowns?.some(b => b.leagueValues?.length > 0)),
      recommendation: 'Check inferredLeague field in each breakdown - now using evar19 (sport) and evar21 (league)'
    }
  };
}

/**
 * Helper to infer league from sport/league evars (evar19 and evar21)
 */
function inferLeagueFromSportLeague(sportValues, leagueValues, evar67) {
  // Check league first (most specific)
  if (leagueValues?.length > 0) {
    // Return the league with most clicks
    const topLeague = leagueValues.sort((a, b) => b.clicks - a.clicks)[0];
    return topLeague.league;
  }

  // Check sport next
  if (sportValues?.length > 0) {
    const topSport = sportValues.sort((a, b) => b.clicks - a.clicks)[0];
    return topSport.sport;
  }

  // Fall back to evar67 parsing
  const e67 = evar67?.toLowerCase() || '';
  if (e67.includes('football')) return 'Football (no league data)';
  if (e67.includes('basketball')) return 'Basketball (no league data)';
  if (e67.includes('cricket')) return 'Cricket';
  
  return 'Unknown';
}

/**
 * Helper to infer league from context (page values are most reliable, evar3 is fantasy context)
 * @deprecated Use inferLeagueFromSportLeague instead
 */
function inferLeagueFromContext(evar3Values, pageValues, evar67) {
  // Check page dimension first - this has the actual page name with league
  // e.g., "espn:nfl:game:gamecast" tells us it's NFL
  for (const v of pageValues || []) {
    const page = v.page?.toLowerCase() || '';
    if (page.includes(':nfl:') || page.startsWith('nfl:')) return 'NFL';
    if (page.includes(':nba:') || page.startsWith('nba:')) return 'NBA';
    if (page.includes(':ncf:') || page.startsWith('ncf:')) return 'NCAAF';
    if (page.includes(':ncb:') || page.startsWith('ncb:')) return 'NCAB';
    if (page.includes(':nhl:') || page.startsWith('nhl:')) return 'NHL';
    if (page.includes(':mlb:') || page.startsWith('mlb:')) return 'MLB';
    if (page.includes(':soccer:') || page.startsWith('soccer:')) return 'Soccer';
    if (page.includes(':cricket:') || page.startsWith('cricket:')) return 'Cricket';
  }

  // evar3 is fantasy context (ffl = fantasy football, fba = fantasy basketball)
  // Not reliable for determining actual sport page, but can be a hint
  // Skip this for now since it's misleading

  // Fall back to evar67 parsing
  const e67 = evar67?.toLowerCase() || '';
  if (e67.includes('football')) return 'Football (check page breakdown)';
  if (e67.includes('basketball')) return 'Basketball (check page breakdown)';
  if (e67.includes('cricket')) return 'Cricket';
  
  return 'Unknown (check page breakdown)';
}

/**
 * List all dimensions in the report suite with their friendly names
 * This helps find where c.league, c.sport, c.pageDetail are mapped
 */
async function listAllDimensions() {
  if (!ADOBE_REPORT_SUITE_ID) {
    throw new Error('ADOBE_REPORT_SUITE_ID is required');
  }

  let data;
  let apiError = null;
  
  // Try different API endpoints
  const endpoints = [
    `/dimensions?rsid=${ADOBE_REPORT_SUITE_ID}`,
    `/dimensions?rsid=${ADOBE_REPORT_SUITE_ID}&locale=en_US`,
    `/reportsuites/${ADOBE_REPORT_SUITE_ID}/dimensions`
  ];
  
  for (const endpoint of endpoints) {
    try {
      console.log(`Trying dimensions endpoint: ${endpoint}`);
      data = await apiRequest(endpoint);
      if (data) break;
    } catch (err) {
      apiError = err;
      console.log(`Endpoint ${endpoint} failed: ${err.message}`);
    }
  }
  
  // If API endpoints don't work, return manual guidance
  if (!data || data.length === 0) {
    return {
      reportSuite: ADOBE_REPORT_SUITE_ID,
      apiError: apiError?.message || 'Could not fetch dimensions',
      manualLookup: {
        instructions: 'Check Adobe Analytics Admin Console for variable mappings',
        path: 'Admin → Report Suites → Edit Settings → Conversion → Conversion Variables (eVars)',
        alternativePath: 'Admin → Report Suites → Edit Settings → General → Processing Rules',
        commonMappings: [
          'c.league is often mapped to evar10-20 range',
          'c.sport is often mapped to evar10-20 range', 
          'c.pageDetail might be mapped to prop or evar'
        ]
      },
      suggestedEndpoint: 'Try /api/analytics/find-league-sport-vars to search for league values across evars'
    };
  }
  
  // Filter and organize dimensions
  const evars = [];
  const props = [];
  const others = [];
  
  for (const dim of (data || [])) {
    const entry = {
      id: dim.id,
      name: dim.name,
      description: dim.description || '',
      type: dim.type
    };
    
    if (dim.id?.includes('evar')) {
      evars.push(entry);
    } else if (dim.id?.includes('prop')) {
      props.push(entry);
      } else {
      others.push(entry);
    }
  }
  
  // Sort evars and props by number
  const sortByNum = (a, b) => {
    const numA = parseInt(a.id.match(/\d+/)?.[0] || '0');
    const numB = parseInt(b.id.match(/\d+/)?.[0] || '0');
    return numA - numB;
  };
  
  evars.sort(sortByNum);
  props.sort(sortByNum);
  
  // Find likely league/sport mappings by name
  const likelyMappings = [...evars, ...props].filter(d => {
    const searchText = (d.name + ' ' + d.description).toLowerCase();
    return searchText.includes('league') || 
           searchText.includes('sport') || 
           searchText.includes('pagedetail') ||
           searchText.includes('page detail') ||
           searchText.includes('content type');
  });
  
  return {
    reportSuite: ADOBE_REPORT_SUITE_ID,
    totalDimensions: (data || []).length,
    likelyLeagueSportMappings: likelyMappings,
    evars: evars.slice(0, 75), // First 75 evars
    props: props.slice(0, 75), // First 75 props
    hint: 'Look for names containing "league", "sport", or "pageDetail" in likelyLeagueSportMappings'
  };
}

/**
 * Find which evars contain league/sport values by searching for known values
 */
async function findLeagueSportVars() {
  if (!ADOBE_REPORT_SUITE_ID) {
    throw new Error('ADOBE_REPORT_SUITE_ID is required');
  }

  const today = new Date();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const startDate = sevenDaysAgo.toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];

  // Search for league-like values (nfl, nba, etc.) across evars 6-50
  const evarsToCheck = [];
  for (let i = 6; i <= 50; i++) {
    evarsToCheck.push({ id: `variables/evar${i}`, name: `evar${i}` });
  }
  // Also check props 6-30
  for (let i = 6; i <= 30; i++) {
    evarsToCheck.push({ id: `variables/prop${i}`, name: `prop${i}` });
  }

  const results = [];

  for (const evar of evarsToCheck) {
    try {
      // Search for common league values
      const data = await apiRequest('/reports', {
        method: 'POST',
        data: {
          rsid: ADOBE_REPORT_SUITE_ID,
          globalFilters: [{
            type: 'dateRange',
            dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
          }],
          metricContainer: {
            metrics: [{ id: 'metrics/occurrences', columnId: '0' }]
          },
          dimension: evar.id,
          search: { clause: `MATCH 'nfl' OR MATCH 'nba' OR MATCH 'ncaaf' OR MATCH 'ncaab' OR MATCH 'nhl' OR MATCH 'mlb' OR MATCH 'soccer' OR MATCH 'football' OR MATCH 'basketball'` },
          settings: { countRepeatInstances: true, limit: 10 }
        }
      });

      const values = (data?.rows || []).map(r => ({
        value: r.value,
        count: r.data?.[0] || 0
      }));

      if (values.length > 0) {
        results.push({
          variable: evar.name,
          variableId: evar.id,
          matchingValues: values,
          likelyType: detectVarType(values)
        });
      }

      await new Promise(r => setTimeout(r, 50));
    } catch (err) {
      // Skip errors silently
    }
  }

  return {
    dateRange: { start: startDate, end: endDate },
    foundVariables: results,
    summary: {
      leagueVars: results.filter(r => r.likelyType === 'league'),
      sportVars: results.filter(r => r.likelyType === 'sport'),
      otherVars: results.filter(r => r.likelyType === 'other')
    }
  };
}

/**
 * Detect if values look like league names, sport names, or something else
 */
function detectVarType(values) {
  const allValues = values.map(v => v.value?.toLowerCase() || '');
  
  // Check for exact league codes
  const leagueCodes = ['nfl', 'nba', 'nhl', 'mlb', 'ncaaf', 'ncaab', 'ncf', 'ncb', 'mls'];
  const hasLeagueCodes = allValues.some(v => leagueCodes.includes(v));
  if (hasLeagueCodes) return 'league';
  
  // Check for sport names
  const sportNames = ['football', 'basketball', 'hockey', 'baseball', 'soccer'];
  const hasSportNames = allValues.some(v => sportNames.includes(v));
  if (hasSportNames) return 'sport';
  
  return 'other';
}

/**
 * Get the actual page names where bet clicks occurred (using breakdown)
 * This queries evar67 for bet clicks, then breaks down by page dimension
 */
async function getBetClicksWithPageBreakdown() {
  if (!ADOBE_REPORT_SUITE_ID) {
    throw new Error('ADOBE_REPORT_SUITE_ID is required');
  }

  const today = new Date();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const startDate = sevenDaysAgo.toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];

  // Step 1: Get top bet click events from evar67
  const betClicksData = await apiRequest('/reports', {
    method: 'POST',
    data: {
      rsid: ADOBE_REPORT_SUITE_ID,
      globalFilters: [{
        type: 'dateRange',
        dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
      }],
      metricContainer: {
        metrics: [{ id: 'metrics/occurrences', columnId: '0' }]
      },
      dimension: 'variables/evar67',
      search: { clause: `CONTAINS 'draft kings'` },
      settings: { countRepeatInstances: true, limit: 20 }
    }
  });

  const results = [];

  // Step 2: For each bet click event, break down by page to see where it occurred
  for (const row of (betClicksData?.rows || []).slice(0, 10)) {
    const evar67Value = row.value;
    const itemId = row.itemId;
    const totalClicks = row.data?.[0] || 0;

    try {
      // Breakdown this specific evar67 value by page dimension
      const breakdown = await apiRequest('/reports', {
        method: 'POST',
        data: {
          rsid: ADOBE_REPORT_SUITE_ID,
          globalFilters: [{
            type: 'dateRange',
            dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
          }],
          metricContainer: {
            metrics: [{ id: 'metrics/occurrences', columnId: '0' }]
          },
          dimension: 'variables/page',
          metricsFilters: [{
            id: 'evar67filter',
            type: 'breakdown', 
            dimension: 'variables/evar67',
            itemId: itemId
          }],
          settings: { countRepeatInstances: true, limit: 5 }
        }
      });

      results.push({
        evar67: evar67Value,
        totalClicks,
        pages: (breakdown?.rows || []).map(r => ({
          page: r.value,
          clicks: r.data?.[0] || 0
        }))
      });
    } catch (err) {
      results.push({
        evar67: evar67Value,
        totalClicks,
        error: err.message
      });
    }

    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 200));
  }

  return {
    method: 'evar67 breakdown by page',
    dateRange: { start: startDate, end: endDate },
    results,
    note: 'Shows the actual page name where each bet click event occurred'
  };
}

/**
 * Get bet clicks broken down by page name (using segment filter)
 * This filters for bet click events first, then breaks down by page
 */
async function getBetClicksByPage() {
  if (!ADOBE_REPORT_SUITE_ID) {
    throw new Error('ADOBE_REPORT_SUITE_ID is required');
  }

  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const startDate = thirtyDaysAgo.toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];

  // Query: Get page dimension, but only count occurrences where evar67 contains bet click data
  // This uses a segment to filter for bet clicks, then breaks down by page
  const [draftKingsData, espnBetData] = await Promise.all([
    apiRequest('/reports', {
      method: 'POST',
      data: {
        rsid: ADOBE_REPORT_SUITE_ID,
        globalFilters: [
          {
            type: 'dateRange',
            dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
          }
        ],
        metricContainer: {
          metrics: [{ 
            id: 'metrics/occurrences', 
            columnId: '0',
            filters: ['evar67Filter']
          }],
          metricFilters: [{
            id: 'evar67Filter',
            type: 'breakdown',
            dimension: 'variables/evar67',
            itemIds: [] // Will use search clause
          }]
        },
        dimension: 'variables/page',
        search: { clause: `CONTAINS 'gamecast' OR CONTAINS 'scoreboard' OR CONTAINS 'schedule' OR CONTAINS 'odds'` },
        settings: { countRepeatInstances: true, limit: 100 }
      }
    }).catch(e => {
      console.log('Draft Kings query failed:', e.message);
      return null;
    }),
    // Simpler approach: query evar67 first to get bet clicks, then we can map to pages
    apiRequest('/reports', {
      method: 'POST', 
      data: {
        rsid: ADOBE_REPORT_SUITE_ID,
        globalFilters: [{
          type: 'dateRange',
          dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
        }],
        metricContainer: {
          metrics: [{ id: 'metrics/occurrences', columnId: '0' }]
        },
        dimension: 'variables/evar67',
        search: { clause: `CONTAINS 'draft kings'` },
        settings: { countRepeatInstances: true, limit: 200 }
      }
    }).catch(e => {
      console.log('ESPN Bet query failed:', e.message);
      return null;
    })
  ]);

  // Process evar67 results and extract page info
  const pageClicks = {};
  
  (espnBetData?.rows || []).forEach(row => {
    const value = row.value || '';
    const clicks = row.data?.[0] || 0;
    
    // Extract page from evar67: "draft kings:espn:nfl:game:gamecast:..." -> "espn:nfl:game:gamecast"
    const espnMatch = value.match(/espn:([^:]+):(?:game:|match:)?([^:]+)/i);
    if (espnMatch) {
      const sport = espnMatch[1];
      const pageType = espnMatch[2];
      const pageName = `espn:${sport}:${pageType}`;
      
      if (!pageClicks[pageName]) {
        pageClicks[pageName] = { clicks: 0, samples: [] };
      }
      pageClicks[pageName].clicks += clicks;
      if (pageClicks[pageName].samples.length < 3) {
        pageClicks[pageName].samples.push(value);
      }
    }
  });

  // Sort by clicks
  const results = Object.entries(pageClicks)
    .map(([page, data]) => ({
      page,
      clicks: data.clicks,
      samples: data.samples
    }))
    .sort((a, b) => b.clicks - a.clicks);

  return {
    method: 'evar67 parsed to page names',
    dateRange: { start: startDate, end: endDate },
    totalPages: results.length,
    totalClicks: results.reduce((sum, r) => sum + r.clicks, 0),
    results,
    note: 'Click counts are bet clicks only, not total page views'
  };
}

/**
 * Explore any dimension filtered to bet click interactions
 * Useful for discovering what variables are available
 * @param {string} dimension - e.g., 'variables/page', 'variables/pagename', 'variables/evar67', etc.
 */
async function exploreBetClickDimension(dimension = 'variables/page') {
  if (!ADOBE_REPORT_SUITE_ID) {
    throw new Error('ADOBE_REPORT_SUITE_ID is required');
  }

  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const startDate = thirtyDaysAgo.toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];

  // First, get bet click events filtered by evar67 containing 'draft kings' or 'espnbet'
  // Then break down by the requested dimension
  const results = {};
  
  // Common dimensions to suggest
  const suggestedDimensions = [
    'variables/page',           // Page name (e.g., "espn:nfl:game:gamecast")
    'variables/pagename',       // Same as page
    'variables/evar67',         // event_detail - what we currently use
    'variables/evar74',         // Full interaction tracking
    'variables/prop1',          // Often contains page info
    'variables/prop2',
    'variables/sitesection',    // Site section
    'variables/channel',        // Channel/sport
    'variables/server',         // Server/domain
  ];

  try {
    // Query with bet click filter (evar67 contains draft kings or espnbet)
    const [draftKingsData, espnBetData] = await Promise.all([
      apiRequest('/reports', {
        method: 'POST',
        data: {
          rsid: ADOBE_REPORT_SUITE_ID,
          globalFilters: [
            {
              type: 'dateRange',
              dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
            },
            {
              type: 'breakdown',
              dimension: 'variables/evar67',
              itemId: '0', // Will be filtered by search
            }
          ],
          metricContainer: {
            metrics: [{ id: 'metrics/occurrences', columnId: '0' }],
            metricFilters: [{
              id: '0',
              type: 'breakdown',
              dimension: 'variables/evar67',
              itemIds: ['0']
            }]
          },
          dimension: dimension,
          search: { clause: `CONTAINS 'draft kings'` },
          settings: { countRepeatInstances: true, limit: 100 }
        }
      }).catch(() => null),
      apiRequest('/reports', {
        method: 'POST',
        data: {
          rsid: ADOBE_REPORT_SUITE_ID,
          globalFilters: [{
            type: 'dateRange',
            dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
          }],
          metricContainer: {
            metrics: [{ id: 'metrics/occurrences', columnId: '0' }]
          },
          dimension: dimension,
          search: { clause: `CONTAINS 'espnbet' OR CONTAINS 'draft kings' OR CONTAINS 'gamecast' OR CONTAINS 'scoreboard'` },
          settings: { countRepeatInstances: true, limit: 100 }
        }
      }).catch(() => null)
    ]);

    // Process results
    const combinedRows = [
      ...(draftKingsData?.rows || []),
      ...(espnBetData?.rows || [])
    ];

    // Dedupe and sort by clicks
    const valueMap = {};
    combinedRows.forEach(row => {
      const key = row.value || 'unknown';
      if (!valueMap[key]) {
        valueMap[key] = { value: key, clicks: 0, itemId: row.itemId };
      }
      valueMap[key].clicks += row.data?.[0] || 0;
    });

    const sortedResults = Object.values(valueMap)
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 50);

    return {
      dimension,
      dateRange: { start: startDate, end: endDate },
      totalResults: sortedResults.length,
      results: sortedResults,
      suggestedDimensions,
      hint: `Try other dimensions: /api/analytics/explore-bet-clicks?dim=variables/pagename`
    };
  } catch (error) {
    return {
      dimension,
      error: error.message,
      suggestedDimensions,
      hint: `Try: ${suggestedDimensions.join(', ')}`
    };
  }
}

/**
 * Get bet clicks grouped by page name using the ESPN Bet Clicks segment
 * This is the correct approach - uses a pre-defined segment to filter to bet clicks
 */
async function getBetClicksByPageDirect() {
  if (!ADOBE_REPORT_SUITE_ID) {
    throw new Error('ADOBE_REPORT_SUITE_ID is required');
  }

  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const startDate = thirtyDaysAgo.toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];

  try {
    console.log('Querying bet clicks by page using All Bet Clicks segment...');
    
    // Use the All Bet Clicks segment (DraftKings + ESPN Bet) to filter, then get PageName breakdown
    const data = await apiRequest('/reports', {
      method: 'POST',
      data: {
        rsid: ADOBE_REPORT_SUITE_ID,
        globalFilters: [
          {
            type: 'segment',
            segmentId: ALL_BET_CLICKS_SEGMENT_ID
          },
          {
            type: 'dateRange',
            dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
          }
        ],
        metricContainer: {
          metrics: [{
            columnId: '0',
            id: 'metrics/occurrences',
            sort: 'desc'
          }]
        },
        dimension: 'variables/evar13', // PageName (v13)
        settings: {
          countRepeatInstances: true,
          limit: 100
        }
      }
    });

    const pages = (data?.rows || []).map(r => {
      const pageName = r.value || '';
      const clicks = r.data?.[0] || 0;
      const league = extractLeagueFromPage(pageName);
      const pageType = extractPageTypeFromPageName(pageName);
      
      return {
        pageName,
        clicks,
        league,
        pageType,
        percentage: 0 // Will calculate below
      };
    });

    const totalClicks = pages.reduce((sum, p) => sum + p.clicks, 0);
    pages.forEach(p => {
      p.percentage = totalClicks > 0 ? ((p.clicks / totalClicks) * 100).toFixed(1) + '%' : '0%';
    });

    // Group by league
    const byLeague = {};
    pages.forEach(p => {
      const league = p.league || 'Other';
      if (!byLeague[league]) {
        byLeague[league] = { league, totalClicks: 0, pages: [] };
      }
      byLeague[league].totalClicks += p.clicks;
      byLeague[league].pages.push(p);
    });

    // Group by page type
    const byPageType = {};
    pages.forEach(p => {
      const pageType = p.pageType || 'other';
      if (!byPageType[pageType]) {
        byPageType[pageType] = { pageType, totalClicks: 0, pages: [] };
      }
      byPageType[pageType].totalClicks += p.clicks;
      byPageType[pageType].pages.push(p);
    });

    return {
      dateRange: { start: startDate, end: endDate },
      segmentUsed: 'All Bet Clicks (DraftKings + ESPN Bet)',
      segmentId: ALL_BET_CLICKS_SEGMENT_ID,
      totalBetClicks: totalClicks,
      totalPages: pages.length,
      pages: pages.slice(0, 50),
      byLeague: Object.values(byLeague).sort((a, b) => b.totalClicks - a.totalClicks),
      byPageType: Object.values(byPageType).sort((a, b) => b.totalClicks - a.totalClicks),
      success: true
    };
  } catch (error) {
    return {
      error: error.message,
      segmentId: ALL_BET_CLICKS_SEGMENT_ID,
      suggestion: 'Make sure the segment ID is correct and accessible to your API credentials'
    };
  }
}

/**
 * Extract page type from page name like "espn:nfl:game:gamecast"
 */
function extractPageTypeFromPageName(pageName) {
  if (!pageName) return 'other';
  const lower = pageName.toLowerCase();
  
  if (lower.includes(':gamecast') || lower.includes('game:gamecast')) return 'gamecast';
  if (lower.includes(':scoreboard')) return 'scoreboard';
  if (lower.includes(':odds')) return 'odds';
  if (lower.includes(':schedule')) return 'schedule';
  if (lower.includes(':story')) return 'story';
  if (lower.includes(':index') || lower.includes(':frontpage')) return 'index';
  if (lower.includes('interstitial')) return 'interstitial';
  
  return 'other';
}

/**
 * Extract league from page name like "espn:nfl:game:gamecast"
 */
function extractLeagueFromPage(pageName) {
  if (!pageName) return null;
  const lower = pageName.toLowerCase();
  
  if (lower.includes(':nfl:') || lower.startsWith('nfl:')) return 'NFL';
  if (lower.includes(':nba:') || lower.startsWith('nba:')) return 'NBA';
  if (lower.includes(':ncf:') || lower.startsWith('ncf:')) return 'NCAAF';
  if (lower.includes(':ncb:') || lower.startsWith('ncb:')) return 'NCAB';
  if (lower.includes(':nhl:') || lower.startsWith('nhl:')) return 'NHL';
  if (lower.includes(':mlb:') || lower.startsWith('mlb:')) return 'MLB';
  if (lower.includes(':soccer:') || lower.startsWith('soccer:')) return 'Soccer';
  if (lower.includes(':cricket:') || lower.includes('cricinfo')) return 'Cricket';
  
  return null;
}

/**
 * Extract league from evar67 string
 * Formats: 
 *   "draft kings:espn:nfl:game:gamecast:..." -> NFL
 *   "draft kings:football:game:gamecast:..." -> Football (ambiguous)
 */
function extractLeagueFromEvar67(evar67) {
  if (!evar67) return null;
  const lower = evar67.toLowerCase();
  
  // Check for specific league codes in the string
  if (lower.includes(':nfl:') || lower.includes('espn:nfl')) return 'NFL';
  if (lower.includes(':nba:') || lower.includes('espn:nba')) return 'NBA';
  if (lower.includes(':ncf:') || lower.includes('espn:ncf')) return 'NCAAF';
  if (lower.includes(':ncb:') || lower.includes('espn:ncb')) return 'NCAB';
  if (lower.includes(':nhl:') || lower.includes('espn:nhl')) return 'NHL';
  if (lower.includes(':mlb:') || lower.includes('espn:mlb')) return 'MLB';
  if (lower.includes(':soccer:') || lower.includes('espn:soccer')) return 'Soccer';
  if (lower.includes('cricket')) return 'Cricket';
  
  // Generic sport terms (ambiguous - could be multiple leagues)
  if (lower.includes(':football:')) return 'Football (NFL or NCAAF)';
  if (lower.includes(':basketball:')) return 'Basketball (NBA or NCAB)';
  
  // Scoreboard without sport
  if (lower.includes('scoreboard:draft') || lower.startsWith('scoreboard:')) return 'Scoreboard (unknown league)';
  
  return null;
}

/**
 * Extract page type from evar67 (gamecast, scoreboard, etc.)
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

/**
 * TEST: Multi-column approach to get Page × Day matrix in ONE API call
 * Each column is occurrences filtered to a specific day
 */
async function testPageDayMatrix(numDays = 7) {
  if (!ADOBE_REPORT_SUITE_ID) {
    throw new Error('ADOBE_REPORT_SUITE_ID is required');
  }

  console.log(`\n🧪 Testing Page × Day matrix with ${numDays} day columns...`);
  
  // Generate date range (last N days)
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - numDays + 1);
  
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];
  
  console.log(`  Date range: ${startDateStr} to ${endDateStr}`);
  
  const startTime = Date.now();
  
  // Step 1: Get day itemIds first (time dimensions require itemId, not itemValue)
  console.log(`  Step 1: Fetching day itemIds...`);
  
  const daysResponse = await apiRequest('/reports', {
    method: 'POST',
    data: {
      rsid: ADOBE_REPORT_SUITE_ID,
      globalFilters: [
        { type: 'segment', segmentId: ALL_BET_CLICKS_SEGMENT_ID },
        { type: 'dateRange', dateRange: `${startDateStr}T00:00:00.000/${endDateStr}T23:59:59.999` }
      ],
      metricContainer: {
        metrics: [{ columnId: '0', id: 'metrics/occurrences' }]
      },
      dimension: 'variables/daterangeday',
      settings: { countRepeatInstances: true, limit: numDays + 5, dimensionSort: 'asc' }
    }
  });
  
  const days = (daysResponse?.rows || []).map(row => ({
    itemId: row.itemId,
    value: row.value, // "Dec 19, 2025"
    clicks: row.data?.[0] || 0
  }));
  
  console.log(`  Got ${days.length} days with itemIds`);
  if (days.length > 0) {
    console.log(`  Sample: ${days[0].value} -> itemId: ${days[0].itemId}`);
  }
  
  if (days.length === 0) {
    return { success: false, error: 'No days returned from initial query' };
  }
  
  // Step 2: Build multi-column query using itemIds
  console.log(`  Step 2: Building multi-column query with ${days.length} day columns...`);
  
  const metrics = days.map((day, idx) => ({
    columnId: String(idx),
    id: 'metrics/occurrences',
    filters: [String(idx)]
  }));
  
  const metricFilters = days.map((day, idx) => ({
    id: String(idx),
    type: 'breakdown',
    dimension: 'variables/daterangeday',
    itemId: day.itemId  // Use itemId instead of itemValue!
  }));
  
  console.log(`  Built ${metrics.length} metric columns`);
  console.log(`  Sample filter: ${JSON.stringify(metricFilters[0])}`);
  
  // Step 3: Make the multi-column query
  try {
    const response = await apiRequest('/reports', {
      method: 'POST',
      data: {
        rsid: ADOBE_REPORT_SUITE_ID,
        globalFilters: [
          { type: 'segment', segmentId: ALL_BET_CLICKS_SEGMENT_ID },
          { type: 'dateRange', dateRange: `${startDateStr}T00:00:00.000/${endDateStr}T23:59:59.999` }
        ],
        metricContainer: {
          metrics,
          metricFilters
        },
        dimension: 'variables/evar13', // Page Name
        settings: {
          countRepeatInstances: true,
          limit: 50, // Top 50 pages
          page: 0
        }
      }
    });
    
    const elapsed = Date.now() - startTime;
    console.log(`  ✅ Response received in ${elapsed}ms`);
    console.log(`  Rows returned: ${response?.rows?.length || 0}`);
    console.log(`  Columns returned: ${response?.columns?.columnIds?.length || 0}`);
    
    // Parse the response into a Page × Day matrix
    const matrix = {};
    
    // Convert Adobe date format "Dec 19, 2025" to ISO "2025-12-19"
    const dateLabels = days.map(d => {
      const parsed = new Date(d.value);
      return !isNaN(parsed) ? parsed.toISOString().split('T')[0] : d.value;
    });
    
    (response?.rows || []).forEach(row => {
      const pageName = row.value;
      matrix[pageName] = {
        page: pageName,
        total: 0,
        dailyClicks: {}
      };
      
      // Each column corresponds to a date
      (row.data || []).forEach((clicks, idx) => {
        if (idx < dateLabels.length) {
          matrix[pageName].dailyClicks[dateLabels[idx]] = clicks;
          matrix[pageName].total += clicks;
        }
      });
    });
    
    // Show sample results
    const pages = Object.values(matrix).sort((a, b) => b.total - a.total);
    console.log(`\n  Top 5 pages with daily breakdown:`);
    pages.slice(0, 5).forEach(p => {
      console.log(`    ${p.page}: ${p.total} total`);
      const dailyStr = Object.entries(p.dailyClicks)
        .map(([d, c]) => `${d.slice(5)}: ${c}`)
        .join(', ');
      console.log(`      Daily: ${dailyStr}`);
    });
    
    return {
      success: true,
      method: 'multi-column-matrix',
      numDays: days.length,
      numPages: pages.length,
      dateRange: { start: startDateStr, end: endDateStr },
      dates: dateLabels,
      pages: pages.slice(0, 20),
      elapsedMs: elapsed,
      apiCalls: 2, // 1 to get day itemIds + 1 for matrix
      note: 'Full Page × Day matrix in 2 API calls!'
    };
    
  } catch (error) {
    console.log(`  ❌ Error: ${error.message}`);
    
    // Log detailed error info
    const errorDetails = error.response?.data || error.message;
    console.log(`  Error details:`, JSON.stringify(errorDetails, null, 2));
    
    return {
      success: false,
      error: error.message,
      errorDetails,
      numDays: days.length,
      daysFound: days.slice(0, 3).map(d => ({ value: d.value, itemId: d.itemId })),
      requestSample: {
        metricsCount: metrics.length,
        filtersCount: metricFilters.length,
        sampleMetric: metrics[0],
        sampleFilter: metricFilters[0]
      },
      suggestion: 'The multi-column approach may have limits on number of columns'
    };
  }
}

module.exports = { 
  getStats, 
  getAnalyticsData, 
  getProjectAnalytics, 
  getTopPages, 
  findPage, 
  listReportSuites, 
  getClickAnalytics, 
  getTopClickEvents, 
  getClicksBySource, 
  getOddsPageClicks, 
  getAllBetClicksByPage, 
  getBetClicksByPageName, 
  getBetClicksBySourcePage,
  getPageDailyBetClicks,
  discoverAllBetClicks,
  exploreBetClickDimension,
  getBetClicksByPage,
  getBetClicksWithPageBreakdown,
  exploreBetClickAttributes,
  exploreEvar67LeagueCorrelation,
  findLeagueSportVars,
  listAllDimensions,
  getBetClicksByPageDirect,
  testPageDayMatrix,
  testAuth 
};
