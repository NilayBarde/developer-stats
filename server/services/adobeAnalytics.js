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
 * Discover Global Company ID from Adobe API (cached)
 */
async function getGlobalCompanyId() {
  if (globalCompanyId) return globalCompanyId;
  
  const token = await getAccessToken();
  const response = await axios.get('https://analytics.adobe.io/discovery/me', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-api-key': ADOBE_CLIENT_ID
    }
  });
  
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
  
  return axios({
    url: `https://analytics.adobe.io/api/${companyId}${endpoint}`,
    method: options.method || 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-api-key': ADOBE_CLIENT_ID,
      'x-gw-ims-org-id': ADOBE_ORG_ID,
      'Content-Type': 'application/json'
    },
    data: options.data,
    timeout: 30000
  }).then(res => res.data);
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
 */
async function getOddsPageClicks(launchDate = null, pageToken = 'topeventsodds') {
  if (!ADOBE_REPORT_SUITE_ID) {
    throw new Error('ADOBE_REPORT_SUITE_ID is required');
  }

  const today = new Date();
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  
  const startDate = ninetyDaysAgo.toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];

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
      console.error(`Error getting daily breakdown for ${label}:`, err.message);
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
 */
async function getPageDailyBetClicks(pageName, launchDate = null) {
  if (!ADOBE_REPORT_SUITE_ID) {
    throw new Error('ADOBE_REPORT_SUITE_ID is required');
  }

  const cacheKey = `page-daily-clicks:${pageName}:${launchDate || 'all'}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const today = new Date();
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  
  const startDate = ninetyDaysAgo.toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];

  // Search evar67 for this page pattern with bet click identifiers
  const searchPattern = pageName.replace('espn:', '');
  
  const [newData, legacyData] = await Promise.all([
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
        search: { clause: `CONTAINS 'draft kings' AND CONTAINS '${searchPattern}'` },
        settings: { countRepeatInstances: true, limit: 500 }
      }
    }).catch(() => ({ rows: [] })),
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
        search: { clause: `CONTAINS 'espnbet' AND CONTAINS '${searchPattern}'` },
        settings: { countRepeatInstances: true, limit: 500 }
      }
    }).catch(() => ({ rows: [] }))
  ]);

  // Get itemIds for daily breakdown
  const allItemIds = [
    ...(newData?.rows || []).map(r => r.itemId),
    ...(legacyData?.rows || []).map(r => r.itemId)
  ].filter(Boolean).slice(0, 50);

  const totalClicks = [
    ...(newData?.rows || []),
    ...(legacyData?.rows || [])
  ].reduce((sum, r) => sum + (r.data?.[0] || 0), 0);

  // Get daily breakdown if we have items
  let dailyClicks = {};
  if (allItemIds.length > 0) {
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
            metrics: [{ id: 'metrics/occurrences', columnId: '0' }],
            metricFilters: [{
              id: 'evarFilter',
              type: 'breakdown',
              dimension: 'variables/evar67',
              itemIds: allItemIds
            }]
          },
          dimension: 'variables/daterangeday',
          settings: { countRepeatInstances: true, limit: 400 }
        }
      });

      (dailyData?.rows || []).forEach(row => {
        const dateStr = row.value;
        if (dateStr && /^\w{3} \d{1,2}, \d{4}$/.test(dateStr)) {
          const date = new Date(dateStr).toISOString().split('T')[0];
          dailyClicks[date] = (dailyClicks[date] || 0) + (row.data?.[0] || 0);
        }
      });
    } catch (err) {
      console.log(`Error getting daily breakdown for ${pageName}:`, err.message);
    }
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
    dateRange: { start: startDate, end: endDate }
  };

  cache.set(cacheKey, result, 300);
  return result;
}

// Track in-progress discovery to prevent duplicate concurrent calls
let discoveryInProgress = null;

/**
 * NEW: Get ALL bet clicks using evar66 (event_name) = "betting interaction" etc
 * Then break down by pageName to see where clicks came from
 * This auto-discovers all pages - no manual config needed!
 */
async function discoverAllBetClicks(launchDate = '2025-12-01') {
  if (!ADOBE_REPORT_SUITE_ID) {
    throw new Error('ADOBE_REPORT_SUITE_ID is required');
  }

  const cacheKey = `discover-bet-clicks:${launchDate}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // If discovery is already in progress, wait for it
  if (discoveryInProgress) {
    console.log('  → Discovery already in progress, waiting...');
    return discoveryInProgress;
  }

  const today = new Date();
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  
  const startDate = ninetyDaysAgo.toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];

  console.log('Discovering all bet clicks by page...');
  
  // Mark discovery as in progress
  discoveryInProgress = (async () => {
    try {
      return await _doDiscovery(launchDate, startDate, endDate, cacheKey);
    } finally {
      discoveryInProgress = null;
    }
  })();
  
  return discoveryInProgress;
}

async function _doDiscovery(launchDate, startDate, endDate, cacheKey) {

  // Query evar67 for ALL bet click events (contains espnbet or draft kings)
  // These events have the page context embedded in the value
  const [draftKingsData, espnBetData] = await Promise.all([
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
        settings: { countRepeatInstances: true, limit: 2000 }
      }
    }).catch(err => {
      console.log('Error fetching draft kings data:', err.message);
      return { rows: [] };
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
        search: { clause: `CONTAINS 'espnbet'` },
        settings: { countRepeatInstances: true, limit: 2000 }
      }
    }).catch(err => {
      console.log('Error fetching espnbet data:', err.message);
      return { rows: [] };
    })
  ]);

  // Parse page context from evar67 values and aggregate by page
  const pageClicks = {};
  const pageItemIds = {}; // Store itemIds for daily breakdown
  
  function parsePageFromEvar67(value) {
    // Examples:
    // "draft kings:espn:nfl:game:gamecast:pointSpread:DAL -7" -> "nfl:gamecast"
    // "draft kings:espn:nfl:odds:total:o42.5" -> "nfl:odds"
    // "espnbet:espn:nfl:schedule:moneyline:..." -> "nfl:schedule"
    // "draft kings:espn:ncaaf:game:gamecast:..." -> "ncaaf:gamecast"
    // "draft kings:espn:soccer:match:gamecast:..." -> "soccer:gamecast"
    
    const valueLower = value.toLowerCase();
    
    // Known sports
    const sports = ['nfl', 'nba', 'nhl', 'mlb', 'ncaaf', 'ncaab', 'ncaam', 'ncaaw', 'soccer', 'mma', 'wnba', 'college-football', 'mens-college-basketball', 'womens-college-basketball'];
    
    // Known page types (order matters - check more specific first)
    const pageTypes = ['gamecast', 'scoreboard', 'schedule', 'odds', 'standings', 'boxscore', 'fightcenter', 'index', 'scores'];
    
    // Find sport in the value
    let foundSport = null;
    for (const sport of sports) {
      if (valueLower.includes(`:${sport}:`) || valueLower.includes(`espn:${sport}`)) {
        foundSport = sport;
        // Normalize college sports
        if (foundSport === 'college-football') foundSport = 'ncaaf';
        if (foundSport === 'mens-college-basketball') foundSport = 'ncaab';
        if (foundSport === 'womens-college-basketball') foundSport = 'ncaaw';
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

  // Process DraftKings data
  (draftKingsData?.rows || []).forEach(row => {
    const pageName = parsePageFromEvar67(row.value || '');
    const clicks = row.data?.[0] || 0;
    if (pageName && clicks > 0) {
      if (!pageClicks[pageName]) {
        pageClicks[pageName] = { total: 0, draftKings: 0, espnBet: 0, itemIds: [] };
      }
      pageClicks[pageName].total += clicks;
      pageClicks[pageName].draftKings += clicks;
      if (row.itemId) pageClicks[pageName].itemIds.push(row.itemId);
    }
  });

  // Process ESPN Bet data
  (espnBetData?.rows || []).forEach(row => {
    const pageName = parsePageFromEvar67(row.value || '');
    const clicks = row.data?.[0] || 0;
    if (pageName && clicks > 0) {
      if (!pageClicks[pageName]) {
        pageClicks[pageName] = { total: 0, draftKings: 0, espnBet: 0, itemIds: [] };
      }
      pageClicks[pageName].total += clicks;
      pageClicks[pageName].espnBet += clicks;
      if (row.itemId) pageClicks[pageName].itemIds.push(row.itemId);
    }
  });

  // Convert to sorted array
  const pages = Object.entries(pageClicks)
    .map(([page, data]) => ({
      page,
      label: formatPageLabel(page),
      clicks: data.total,
      draftKingsClicks: data.draftKings,
      espnBetClicks: data.espnBet,
      itemIds: data.itemIds.slice(0, 50) // Keep for daily breakdown
    }))
    .filter(p => p.clicks >= 50) // Filter out noise
    .sort((a, b) => b.clicks - a.clicks);

  console.log(`Found ${pages.length} pages with bet clicks`);

  // Get daily breakdown for ALL pages (not just top 20)
  const launchDateObj = launchDate ? new Date(launchDate + 'T12:00:00') : null;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    
    // Small delay to avoid rate limits
    if (i > 0) await new Promise(r => setTimeout(r, 300));
    
    try {
      // Build search pattern for this page
      const parts = page.page.split(':');
      const sport = parts[0];
      const pageType = parts[1];
      
      // Use the existing getOddsPageClicks function which works correctly
      // It searches evar67 for patterns and gets daily breakdown
      let searchPattern;
      
      // Map normalized sport codes to evar67 names - varies by page type!
      // Schedule pages use long names, gamecasts use short codes
      const sportToEvar67Schedule = {
        'ncaaf': 'college-football',
        'ncaab': 'mens-college-basketball',
        'ncaam': 'mens-college-basketball',
        'ncaaw': 'womens-college-basketball'
      };
      
      if (sport === 'other') {
        // Generic: just match page type
        searchPattern = pageType;
      } else if (pageType === 'gamecast') {
        // Gamecasts use SHORT codes: "ncaaf:game:gamecast", "ncaam:game:gamecast"
        if (sport === 'soccer') {
          searchPattern = 'match:gamecast';
        } else {
          // Use the original sport code (ncaaf, ncaam, nfl, etc.)
          searchPattern = `${sport}:game:gamecast`;
        }
      } else if (pageType === 'schedule') {
        // Schedule pages use LONG names for college sports
        const evar67Sport = sportToEvar67Schedule[sport] || sport;
        searchPattern = `${evar67Sport}:schedule`;
      } else {
        // Other pages (odds, scoreboard, etc.) - use original sport code
        searchPattern = `${sport}:${pageType}`;
      }
      
      // Call the working getOddsPageClicks function
      const clickData = await getOddsPageClicks(launchDate, searchPattern);
      
      if (clickData?.dailyClicks?.length > 0) {
        // Convert array to map
        const dailyClicksMap = {};
        clickData.dailyClicks.forEach(d => {
          dailyClicksMap[d.date] = { clicks: d.clicks };
        });
        page.dailyClicks = dailyClicksMap;
        page.comparison = clickData.comparison;
        console.log(`  ✓ ${page.label}: ${clickData.totalClicks.toLocaleString()} clicks, ${clickData.dailyClicks.length} days`);
      } else {
        console.log(`  ⚠ ${page.label}: No daily data (pattern: ${searchPattern})`);
      }
    } catch (err) {
      console.log(`  ✗ Error for ${page.page}:`, err.message);
    }
  }

  // Dynamically group pages by page type
  // First, collect all page types and their total clicks
  const pageTypeStats = {};
  pages.forEach(page => {
    const pageType = page.page.split(':')[1] || 'other';
    if (!pageTypeStats[pageType]) {
      pageTypeStats[pageType] = { totalClicks: 0, pages: [] };
    }
    pageTypeStats[pageType].totalClicks += page.clicks;
    pageTypeStats[pageType].pages.push(page);
  });

  // Sort page types by total clicks (most clicks first)
  const sortedPageTypes = Object.entries(pageTypeStats)
    .sort((a, b) => b[1].totalClicks - a[1].totalClicks)
    .map(([type]) => type);

  // Sort pages within each type by clicks
  Object.values(pageTypeStats).forEach(stats => {
    stats.pages.sort((a, b) => b.clicks - a.clicks);
  });

  // Create grouped structure for frontend (ordered by total clicks per type)
  const grouped = {};
  sortedPageTypes.forEach(pageType => {
    const stats = pageTypeStats[pageType];
    grouped[pageType] = {
      label: formatPageTypeLabel(pageType),
      totalClicks: stats.totalClicks,
      pages: stats.pages
    };
  });

  // Flatten back to sorted array (grouped by type, then by clicks within type)
  const sortedPages = sortedPageTypes.flatMap(type => pageTypeStats[type].pages);

  const result = {
    pages: sortedPages,
    grouped,
    pageTypes: sortedPageTypes,
    totalPages: pages.length,
    totalClicks: pages.reduce((sum, p) => sum + p.clicks, 0),
    dateRange: { start: startDate, end: endDate },
    launchDate,
    method: 'Auto-discovered from evar67 (event_detail)'
  };

  cache.set(cacheKey, result, 600); // Cache 10 min
  return result;
}

// Format page type to friendly label (dynamic - capitalizes and adds emoji)
function formatPageTypeLabel(pageType) {
  const emoji = {
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
  const icon = emoji[pageType] || '📄';
  const label = pageType.charAt(0).toUpperCase() + pageType.slice(1);
  return `${icon} ${label} Pages`;
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
    return pageType ? `All ${pageType}s` : page;
  }
  
  if (sport && pageType) {
    return `${sport} ${pageType}`;
  }
  return page;
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
  testAuth 
};
