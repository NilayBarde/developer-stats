const { apiRequest, ADOBE_REPORT_SUITE_ID } = require('./api');

// NOTE: These are exploratory/debugging functions for discovering Adobe Analytics dimensions
// They may be marked as dead code or removed in a future cleanup

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
    if (page.includes(':ncb:') || page.startsWith('ncb:')) return 'NCB';
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

/**
 * Get top event details (evar67) for a specific page
 * Shows what specific bet click events are happening on this page
 */

// Exports

module.exports = {
  exploreBetClickAttributes,
  exploreEvar67LeagueCorrelation,
  listAllDimensions,
  findLeagueSportVars,
  exploreBetClickDimension,
  testPageDayMatrix
};
