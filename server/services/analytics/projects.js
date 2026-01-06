const cache = require('../../utils/cache');
const { apiRequest, ADOBE_REPORT_SUITE_ID } = require('./api');
const { getPageAnalytics } = require('./pages');
const { getOddsPageClicks, ALL_BET_CLICKS_SEGMENT_ID } = require('./clicks');

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

async function getPageEventDetails(pageName, startDate, endDate) {
  if (!ADOBE_REPORT_SUITE_ID) {
    throw new Error('ADOBE_REPORT_SUITE_ID is required');
  }

  const cacheKey = `page-event-details:${pageName}:${startDate}:${endDate}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  console.log(`Fetching event details for page: ${pageName}`);

  try {
    // Step 1: Get the itemId for this page name
    const pageResponse = await apiRequest('/reports', {
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
        dimension: 'variables/evar13', // PageName
        settings: {
          countRepeatInstances: true,
          limit: 400,
          search: {
            clause: `MATCH '${pageName}'`
          }
        }
      }
    });

    const pageRow = pageResponse?.rows?.find(r => r.value === pageName);
    if (!pageRow) {
      console.log(`  → Page not found: ${pageName}`);
      return {
        page: pageName,
    dateRange: { start: startDate, end: endDate },
        eventDetails: [],
        totalEvents: 0,
        error: 'Page not found'
      };
    }

    const pageItemId = pageRow.itemId;
    console.log(`  → Found page itemId: ${pageItemId}`);

    // Step 2: Get event details breakdown for this page
    const eventResponse = await apiRequest('/reports', {
      method: 'POST',
      data: {
        rsid: ADOBE_REPORT_SUITE_ID,
        globalFilters: [
          { type: 'segment', segmentId: ALL_BET_CLICKS_SEGMENT_ID },
          { type: 'dateRange', dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999` }
        ],
        metricContainer: {
          metrics: [{ 
            columnId: '0', 
            id: 'metrics/occurrences',
            filters: ['pageFilter']
          }],
          metricFilters: [{
            id: 'pageFilter',
            type: 'breakdown',
            dimension: 'variables/evar13',
            itemId: pageItemId
          }]
        },
        dimension: 'variables/evar67', // event_detail
        settings: {
          countRepeatInstances: true,
          limit: 10
        }
      }
    });

    const eventDetails = (eventResponse?.rows || []).map(row => ({
      eventDetail: row.value || 'Unknown',
      clicks: row.data?.[0] || 0
    })).filter(e => e.clicks > 0);

    const result = {
      page: pageName,
      pageItemId,
      dateRange: { start: startDate, end: endDate },
      eventDetails,
      totalEvents: eventDetails.length
    };

    // Cache for 5 minutes
    cache.set(cacheKey, result, 300);
    
    console.log(`  → Found ${eventDetails.length} event details for ${pageName}`);
  return result;

  } catch (error) {
    console.error(`Error fetching event details for ${pageName}:`, error.message);
    
    // Return empty result on error
    return {
      page: pageName,
      dateRange: { start: startDate, end: endDate },
      eventDetails: [],
      totalEvents: 0,
      error: error.message
    };
  }
}

async function getProjectMetrics(pageFilter, launchDate, endDate, breakdownBy = null) {
  if (!ADOBE_REPORT_SUITE_ID) {
    throw new Error('ADOBE_REPORT_SUITE_ID is required');
  }

  // Use 30 days before launch as start, and project end date (or today)
  const launchDateObj = new Date(launchDate);
  const startDateObj = new Date(launchDateObj);
  startDateObj.setDate(startDateObj.getDate() - 30); // 30 days before launch
  
  const startDate = startDateObj.toISOString().split('T')[0];
  const finalEndDate = endDate || new Date().toISOString().split('T')[0];

  const cacheKey = `project-metrics:${pageFilter}:${startDate}:${finalEndDate}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  console.log(`Fetching project metrics for ${pageFilter} (${startDate} to ${finalEndDate})...`);

  try {
    // Step 1: Get page itemId
    const pageResponse = await apiRequest('/reports', {
      method: 'POST',
      data: {
        rsid: ADOBE_REPORT_SUITE_ID,
        globalFilters: [
          { type: 'dateRange', dateRange: `${startDate}T00:00:00.000/${finalEndDate}T23:59:59.999` }
        ],
        metricContainer: {
          metrics: [{ columnId: '0', id: 'metrics/pageviews' }]
        },
        dimension: 'variables/evar13',
        settings: {
          countRepeatInstances: true,
          limit: 50,
          search: { clause: `MATCH '${pageFilter}'` }
        }
      }
    });

    const pageRow = pageResponse?.rows?.find(r => r.value === pageFilter);
    if (!pageRow) {
      return { error: `Page ${pageFilter} not found`, pageFilter };
    }
    const pageItemId = pageRow.itemId;
    const totalPageViews = pageRow.data?.[0] || 0;

    console.log(`  → Found page ${pageFilter} with ${totalPageViews} page views`);

    // Step 2: Get daily page views
    const dailyPVResponse = await apiRequest('/reports', {
      method: 'POST',
      timeout: 60000,
      data: {
        rsid: ADOBE_REPORT_SUITE_ID,
        globalFilters: [
          { type: 'dateRange', dateRange: `${startDate}T00:00:00.000/${finalEndDate}T23:59:59.999` }
        ],
        metricContainer: {
          metrics: [{ 
            columnId: '0', 
            id: 'metrics/pageviews',
            filters: ['pageFilter']
          }],
          metricFilters: [{
            id: 'pageFilter',
            type: 'breakdown',
            dimension: 'variables/evar13',
            itemId: pageItemId
          }]
        },
        dimension: 'variables/daterangeday',
        settings: { countRepeatInstances: true, limit: 400, dimensionSort: 'asc' }
      }
    });

    // Step 3: Get daily bet clicks for this page
    const dailyBCResponse = await apiRequest('/reports', {
      method: 'POST',
      timeout: 60000,
      data: {
        rsid: ADOBE_REPORT_SUITE_ID,
        globalFilters: [
          { type: 'segment', segmentId: ALL_BET_CLICKS_SEGMENT_ID },
          { type: 'dateRange', dateRange: `${startDate}T00:00:00.000/${finalEndDate}T23:59:59.999` }
        ],
        metricContainer: {
          metrics: [{ 
            columnId: '0', 
            id: 'metrics/occurrences',
            filters: ['pageFilter']
          }],
          metricFilters: [{
            id: 'pageFilter',
            type: 'breakdown',
            dimension: 'variables/evar13',
            itemId: pageItemId
          }]
        },
        dimension: 'variables/daterangeday',
        settings: { countRepeatInstances: true, limit: 400, dimensionSort: 'asc' }
      }
    });

    // Parse daily data
    const dailyData = {};
    let totalBetClicks = 0;

    // Add page views
    (dailyPVResponse?.rows || []).forEach(row => {
      const parsed = new Date(row.value);
      const date = !isNaN(parsed) ? parsed.toISOString().split('T')[0] : row.value;
      if (!dailyData[date]) dailyData[date] = { pageViews: 0, betClicks: 0 };
      dailyData[date].pageViews = row.data?.[0] || 0;
    });

    // Add bet clicks
    (dailyBCResponse?.rows || []).forEach(row => {
      const parsed = new Date(row.value);
      const date = !isNaN(parsed) ? parsed.toISOString().split('T')[0] : row.value;
      if (!dailyData[date]) dailyData[date] = { pageViews: 0, betClicks: 0 };
      dailyData[date].betClicks = row.data?.[0] || 0;
      totalBetClicks += row.data?.[0] || 0;
    });

    // Calculate conversion rates and before/after comparison
    const launchDateStr = launchDate;
    let beforePV = 0, beforeBC = 0, beforeDays = 0;
    let afterPV = 0, afterBC = 0, afterDays = 0;

    Object.entries(dailyData).forEach(([date, data]) => {
      data.conversionRate = data.pageViews > 0 
        ? ((data.betClicks / data.pageViews) * 100).toFixed(2) + '%'
        : '0%';
      
      if (date < launchDateStr) {
        beforePV += data.pageViews;
        beforeBC += data.betClicks;
        beforeDays++;
      } else {
        afterPV += data.pageViews;
        afterBC += data.betClicks;
        afterDays++;
      }
    });

    const comparison = {
      before: {
        days: beforeDays,
        totalPageViews: beforePV,
        totalBetClicks: beforeBC,
        avgPageViews: beforeDays > 0 ? Math.round(beforePV / beforeDays) : 0,
        avgBetClicks: beforeDays > 0 ? Math.round(beforeBC / beforeDays) : 0,
        conversionRate: beforePV > 0 ? ((beforeBC / beforePV) * 100).toFixed(4) + '%' : '0%'
      },
      after: {
        days: afterDays,
        totalPageViews: afterPV,
        totalBetClicks: afterBC,
        avgPageViews: afterDays > 0 ? Math.round(afterPV / afterDays) : 0,
        avgBetClicks: afterDays > 0 ? Math.round(afterBC / afterDays) : 0,
        conversionRate: afterPV > 0 ? ((afterBC / afterPV) * 100).toFixed(4) + '%' : '0%'
      },
      change: {
        pageViewsChange: beforePV > 0 ? Math.round(((afterPV/afterDays) - (beforePV/beforeDays)) / (beforePV/beforeDays) * 100) : null,
        betClicksChange: beforeBC > 0 ? Math.round(((afterBC/afterDays) - (beforeBC/beforeDays)) / (beforeBC/beforeDays) * 100) : null
      }
    };

    // Step 4: Get breakdown by evar (e.g., evar122 for bet account linked)
    let breakdown = null;
    if (breakdownBy) {
      console.log(`  → Fetching breakdown by ${breakdownBy}...`);
      try {
        const breakdownResponse = await apiRequest('/reports', {
          method: 'POST',
          timeout: 60000,
          data: {
            rsid: ADOBE_REPORT_SUITE_ID,
            globalFilters: [
              { type: 'dateRange', dateRange: `${startDate}T00:00:00.000/${finalEndDate}T23:59:59.999` }
            ],
            metricContainer: {
              metrics: [{ 
                columnId: '0', 
                id: 'metrics/pageviews',
                filters: ['pageFilter']
              }],
              metricFilters: [{
                id: 'pageFilter',
                type: 'breakdown',
                dimension: 'variables/evar13',
                itemId: pageItemId
              }]
            },
            dimension: `variables/${breakdownBy}`,
            settings: { countRepeatInstances: true, limit: 10 }
          }
        });

        breakdown = (breakdownResponse?.rows || []).map(row => ({
          value: row.value || 'Unspecified',
          itemId: row.itemId,
          pageViews: row.data?.[0] || 0
        })).filter(b => b.pageViews > 0);

        // Also get bet clicks breakdown
        const bcBreakdownResponse = await apiRequest('/reports', {
          method: 'POST',
          timeout: 60000,
          data: {
            rsid: ADOBE_REPORT_SUITE_ID,
            globalFilters: [
              { type: 'segment', segmentId: ALL_BET_CLICKS_SEGMENT_ID },
              { type: 'dateRange', dateRange: `${startDate}T00:00:00.000/${finalEndDate}T23:59:59.999` }
            ],
            metricContainer: {
              metrics: [{ 
                columnId: '0', 
                id: 'metrics/occurrences',
                filters: ['pageFilter']
              }],
              metricFilters: [{
                id: 'pageFilter',
                type: 'breakdown',
                dimension: 'variables/evar13',
                itemId: pageItemId
              }]
            },
            dimension: `variables/${breakdownBy}`,
            settings: { countRepeatInstances: true, limit: 10 }
          }
        });

        // Merge bet clicks into breakdown
        const bcMap = {};
        (bcBreakdownResponse?.rows || []).forEach(row => {
          bcMap[row.value || 'Unspecified'] = row.data?.[0] || 0;
        });
        
        breakdown = breakdown.map(b => ({
          ...b,
          betClicks: bcMap[b.value] || 0,
          conversionRate: b.pageViews > 0 
            ? ((bcMap[b.value] || 0) / b.pageViews * 100).toFixed(3) + '%' 
            : '0%'
        }));

        // Also get visitors and visits for return visit analysis
        console.log(`  → Fetching visitors/visits for return analysis...`);
        const visitorsResponse = await apiRequest('/reports', {
          method: 'POST',
          timeout: 60000,
          data: {
            rsid: ADOBE_REPORT_SUITE_ID,
            globalFilters: [
              { type: 'dateRange', dateRange: `${startDate}T00:00:00.000/${finalEndDate}T23:59:59.999` }
            ],
            metricContainer: {
              metrics: [
                { columnId: '0', id: 'metrics/visitors', filters: ['pageFilter'] },
                { columnId: '1', id: 'metrics/visits', filters: ['pageFilter'] }
              ],
              metricFilters: [{
                id: 'pageFilter',
                type: 'breakdown',
                dimension: 'variables/evar13',
                itemId: pageItemId
              }]
            },
            dimension: `variables/${breakdownBy}`,
            settings: { countRepeatInstances: true, limit: 10 }
          }
        });

        // Merge visitors/visits into breakdown
        const visitMap = {};
        (visitorsResponse?.rows || []).forEach(row => {
          visitMap[row.value || 'Unspecified'] = {
            visitors: row.data?.[0] || 0,
            visits: row.data?.[1] || 0
          };
        });
        
        breakdown = breakdown.map(b => {
          const visitData = visitMap[b.value] || { visitors: 0, visits: 0 };
          const visitsPerVisitor = visitData.visitors > 0 
            ? (visitData.visits / visitData.visitors).toFixed(2)
            : '0';
          return {
            ...b,
            visitors: visitData.visitors,
            visits: visitData.visits,
            visitsPerVisitor: parseFloat(visitsPerVisitor)
          };
        });

        console.log(`  → Found ${breakdown.length} breakdown values for ${breakdownBy}`);
      } catch (breakdownError) {
        console.error(`  → Breakdown fetch failed:`, breakdownError.message);
      }
    }

    // Step 5: Get year-over-year comparison (same date range, previous year)
    let yearOverYear = null;
    try {
      console.log(`  → Fetching year-over-year comparison...`);
      
      // Calculate previous year date range
      const prevYearStart = new Date(startDate);
      prevYearStart.setFullYear(prevYearStart.getFullYear() - 1);
      const prevYearEnd = new Date(finalEndDate);
      prevYearEnd.setFullYear(prevYearEnd.getFullYear() - 1);
      const prevStartStr = prevYearStart.toISOString().split('T')[0];
      const prevEndStr = prevYearEnd.toISOString().split('T')[0];

      // Fetch previous year page views
      const prevYearPVResponse = await apiRequest('/reports', {
        method: 'POST',
        timeout: 60000,
        data: {
          rsid: ADOBE_REPORT_SUITE_ID,
          globalFilters: [
            { type: 'dateRange', dateRange: `${prevStartStr}T00:00:00.000/${prevEndStr}T23:59:59.999` }
          ],
          metricContainer: {
            metrics: [
              { columnId: '0', id: 'metrics/pageviews' },
              { columnId: '1', id: 'metrics/visitors' },
              { columnId: '2', id: 'metrics/visits' }
            ]
          },
          dimension: 'variables/evar13',
          settings: {
            countRepeatInstances: true,
            limit: 50,
            search: { clause: `MATCH '${pageFilter}'` }
          }
        }
      });

      const prevYearRow = prevYearPVResponse?.rows?.find(r => r.value === pageFilter);
      
      // Fetch previous year bet clicks
      const prevYearBCResponse = await apiRequest('/reports', {
        method: 'POST',
        timeout: 60000,
        data: {
          rsid: ADOBE_REPORT_SUITE_ID,
          globalFilters: [
            { type: 'segment', segmentId: ALL_BET_CLICKS_SEGMENT_ID },
            { type: 'dateRange', dateRange: `${prevStartStr}T00:00:00.000/${prevEndStr}T23:59:59.999` }
          ],
          metricContainer: {
            metrics: [{ columnId: '0', id: 'metrics/occurrences' }]
          },
          dimension: 'variables/evar13',
          settings: {
            countRepeatInstances: true,
            limit: 50,
            search: { clause: `MATCH '${pageFilter}'` }
          }
        }
      });

      const prevYearBCRow = prevYearBCResponse?.rows?.find(r => r.value === pageFilter);

      if (prevYearRow) {
        const prevPageViews = prevYearRow.data?.[0] || 0;
        const prevVisitors = prevYearRow.data?.[1] || 0;
        const prevVisits = prevYearRow.data?.[2] || 0;
        const prevBetClicks = prevYearBCRow?.data?.[0] || 0;
        const prevVisitsPerVisitor = prevVisitors > 0 ? (prevVisits / prevVisitors).toFixed(2) : 0;
        const prevBetClickRate = prevPageViews > 0 ? ((prevBetClicks / prevPageViews) * 100).toFixed(4) + '%' : '0%';

        // Get current year totals for comparison (need visitors/visits)
        const currYearResponse = await apiRequest('/reports', {
          method: 'POST',
          timeout: 60000,
          data: {
            rsid: ADOBE_REPORT_SUITE_ID,
            globalFilters: [
              { type: 'dateRange', dateRange: `${startDate}T00:00:00.000/${finalEndDate}T23:59:59.999` }
            ],
            metricContainer: {
              metrics: [
                { columnId: '0', id: 'metrics/visitors' },
                { columnId: '1', id: 'metrics/visits' }
              ]
            },
            dimension: 'variables/evar13',
            settings: {
              countRepeatInstances: true,
              limit: 50,
              search: { clause: `MATCH '${pageFilter}'` }
            }
          }
        });

        const currYearRow = currYearResponse?.rows?.find(r => r.value === pageFilter);
        const currVisitors = currYearRow?.data?.[0] || 0;
        const currVisits = currYearRow?.data?.[1] || 0;
        const currVisitsPerVisitor = currVisitors > 0 ? (currVisits / currVisitors).toFixed(2) : 0;
        const currBetClickRate = totalPageViews > 0 ? ((totalBetClicks / totalPageViews) * 100).toFixed(4) + '%' : '0%';

        // Fetch daily data for previous year (for YoY chart overlay)
        console.log(`  → Fetching previous year daily data for chart...`);
        const prevYearDailyResponse = await apiRequest('/reports', {
          method: 'POST',
          timeout: 60000,
          data: {
            rsid: ADOBE_REPORT_SUITE_ID,
            globalFilters: [
              { type: 'dateRange', dateRange: `${prevStartStr}T00:00:00.000/${prevEndStr}T23:59:59.999` }
            ],
            metricContainer: {
              metrics: [{ 
                columnId: '0', 
                id: 'metrics/pageviews',
                filters: ['pageFilter']
              }],
              metricFilters: [{
                id: 'pageFilter',
                type: 'breakdown',
                dimension: 'variables/evar13',
                itemId: pageItemId
              }]
            },
            dimension: 'variables/daterangeday',
            settings: { countRepeatInstances: true, limit: 400, dimensionSort: 'asc' }
          }
        });

        // Parse previous year daily data with week number for alignment
        const prevYearDaily = {};
        const seasonStartPrev = new Date(prevStartStr);
        (prevYearDailyResponse?.rows || []).forEach(row => {
          const parsed = new Date(row.value);
          const date = !isNaN(parsed) ? parsed.toISOString().split('T')[0] : row.value;
          // Calculate week number from season start for alignment
          const daysSinceStart = Math.floor((parsed - seasonStartPrev) / (1000 * 60 * 60 * 24));
          const weekNum = Math.floor(daysSinceStart / 7);
          prevYearDaily[date] = {
            pageViews: row.data?.[0] || 0,
            weekNum,
            daysSinceStart
          };
        });

        // Add week numbers to current year daily data
        const seasonStartCurr = new Date(startDate);
        const currYearDaily = {};
        Object.entries(dailyData).forEach(([date, data]) => {
          const parsed = new Date(date);
          const daysSinceStart = Math.floor((parsed - seasonStartCurr) / (1000 * 60 * 60 * 24));
          const weekNum = Math.floor(daysSinceStart / 7);
          currYearDaily[date] = {
            ...data,
            weekNum,
            daysSinceStart
          };
        });

        yearOverYear = {
          previousYear: {
            dateRange: { start: prevStartStr, end: prevEndStr },
            pageViews: prevPageViews,
            visitors: prevVisitors,
            visits: prevVisits,
            visitsPerVisitor: parseFloat(prevVisitsPerVisitor),
            betClicks: prevBetClicks,
            betClickRate: prevBetClickRate,
            dailyData: prevYearDaily
          },
          currentYear: {
            dateRange: { start: startDate, end: finalEndDate },
            pageViews: totalPageViews,
            visitors: currVisitors,
            visits: currVisits,
            visitsPerVisitor: parseFloat(currVisitsPerVisitor),
            betClicks: totalBetClicks,
            betClickRate: currBetClickRate,
            dailyData: currYearDaily
          },
          change: {
            pageViews: prevPageViews > 0 ? Math.round(((totalPageViews - prevPageViews) / prevPageViews) * 100) : null,
            visitors: prevVisitors > 0 ? Math.round(((currVisitors - prevVisitors) / prevVisitors) * 100) : null,
            visits: prevVisits > 0 ? Math.round(((currVisits - prevVisits) / prevVisits) * 100) : null,
            visitsPerVisitor: prevVisitsPerVisitor > 0 ? Math.round(((currVisitsPerVisitor - prevVisitsPerVisitor) / prevVisitsPerVisitor) * 100) : null,
            betClicks: prevBetClicks > 0 ? Math.round(((totalBetClicks - prevBetClicks) / prevBetClicks) * 100) : null
          }
        };

        console.log(`  → YoY: ${prevPageViews} PV (${prevStartStr}) vs ${totalPageViews} PV (${startDate}), ${Object.keys(prevYearDaily).length} daily points`);
      } else {
        console.log(`  → No previous year data found for ${pageFilter}`);
      }
    } catch (yoyError) {
      console.error(`  → Year-over-year fetch failed:`, yoyError.message);
    }

    const result = {
      pageFilter,
      pageItemId,
      dateRange: { start: startDate, end: finalEndDate },
      launchDate,
      totals: {
        pageViews: totalPageViews,
        betClicks: totalBetClicks,
        conversionRate: totalPageViews > 0 ? ((totalBetClicks / totalPageViews) * 100).toFixed(4) + '%' : '0%'
      },
      dailyData,
      comparison,
      breakdown: breakdown ? { dimension: breakdownBy, values: breakdown } : null,
      yearOverYear
    };

    cache.set(cacheKey, result, 300);
    console.log(`  → Project metrics complete: ${totalPageViews} PV, ${totalBetClicks} BC`);
    
    return result;

  } catch (error) {
    console.error(`Error fetching project metrics:`, error.message);
    return { error: error.message, pageFilter };
  }
}

// Exports

module.exports = {
  getProjectAnalytics,
  getProjectMetrics,
  getPageEventDetails
};
