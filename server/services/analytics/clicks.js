const cache = require('../../utils/cache');
const { apiRequest, ADOBE_REPORT_SUITE_ID } = require('./api');
const { formatPageLabel, extractLeagueFromPage, extractPageTypeFromPageName } = require('./pages');

// All Bet Clicks segment ID (DraftKings + ESPN Bet) - created by Nilay
const ALL_BET_CLICKS_SEGMENT_ID = 's300003201_694c7a0c873e3d78f596f84f';

// Track in-progress discovery to prevent duplicate concurrent calls
let discoveryInProgress = null;

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

// Exports

module.exports = {
  getClickAnalytics,
  getTopClickEvents,
  getClicksBySource,
  getOddsPageClicks,
  getAllBetClicksByPage,
  getBetClicksByPageName,
  getBetClicksBySourcePage,
  getPageDailyBetClicks,
  discoverAllBetClicks,
  getBetClicksWithPageBreakdown,
  getBetClicksByPage,
  getBetClicksByPageDirect,
  ALL_BET_CLICKS_SEGMENT_ID
};
