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

module.exports = { getStats, getAnalyticsData, getProjectAnalytics, getTopPages, findPage, listReportSuites, getClickAnalytics, getTopClickEvents, getClicksBySource, getOddsPageClicks, testAuth };
