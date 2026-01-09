/**
 * Script to measure impact of bracket page redesign (Feb 2023)
 * 
 * Queries Adobe Analytics for bracket page metrics before and after the redesign.
 * This is a one-time analysis script - no frontend UI needed.
 */

const { apiRequest, ADOBE_REPORT_SUITE_ID, testAuth } = require('../services/analytics/api');

const BRACKET_PAGE_PATTERNS = [
  'espn:ncb:bracket',      // March Madness
  'espn:ncw:bracket',      // Women's NCAA bracket
  'espn:nba:bracket',      // NBA Playoffs
  'espn:nfl:bracket',      // NFL Playoffs
  'espn:mlb:bracket',      // MLB Playoffs
  'espn:nhl:bracket',      // NHL Playoffs
  'espn:ncf:bracket',      // College Football Playoffs
  'espn:soccer:bracket',   // Soccer tournaments
  'espn:tennis:bracket',   // Tennis tournaments
];

/**
 * Query bracket page metrics for a specific date range
 */
async function getBracketMetrics(startDate, endDate, searchTerm = 'bracket') {
  console.log(`\nQuerying bracket metrics for ${startDate} to ${endDate}...`);
  
  const globalFilters = [{
    type: 'dateRange',
    dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
  }];

  try {
    const data = await apiRequest('/reports', {
      method: 'POST',
      data: {
        rsid: ADOBE_REPORT_SUITE_ID,
        globalFilters,
        metricContainer: {
          metrics: [
            { id: 'metrics/pageviews', columnId: '0' },
            { id: 'metrics/visitors', columnId: '1' },
            { id: 'metrics/visits', columnId: '2' }
          ]
        },
        dimension: 'variables/page',
        search: { clause: `CONTAINS '${searchTerm}'` },
        settings: { countRepeatInstances: true, limit: 500 }
      }
    });

    const pages = (data?.rows || [])
      .filter(row => {
        const pageName = (row.value || '').toLowerCase();
        // Only include ESPN bracket pages, not fantasy bracket games
        return pageName.includes('bracket') && 
               !pageName.includes('fantasy') &&
               (pageName.startsWith('espn:') || pageName.startsWith('espnau:') || 
                pageName.startsWith('espnuk:') || pageName.startsWith('espnmx:'));
      })
      .map(row => ({
        page: row.value,
        pageViews: row.data?.[0] || 0,
        visitors: row.data?.[1] || 0,
        visits: row.data?.[2] || 0
      }))
      .sort((a, b) => b.pageViews - a.pageViews);

    const totals = pages.reduce((acc, p) => ({
      pageViews: acc.pageViews + p.pageViews,
      visitors: acc.visitors + p.visitors,
      visits: acc.visits + p.visits
    }), { pageViews: 0, visitors: 0, visits: 0 });

    return {
      dateRange: { start: startDate, end: endDate },
      pages,
      totals,
      pageCount: pages.length
    };
  } catch (err) {
    console.error(`Error querying ${startDate} to ${endDate}:`, err.message);
    return { error: err.message, dateRange: { start: startDate, end: endDate } };
  }
}

/**
 * Query by specific bracket type/tournament
 */
async function getBracketTypeMetrics(startDate, endDate, bracketType) {
  console.log(`\nQuerying ${bracketType} brackets for ${startDate} to ${endDate}...`);
  
  const globalFilters = [{
    type: 'dateRange',
    dateRange: `${startDate}T00:00:00.000/${endDate}T23:59:59.999`
  }];

  try {
    const data = await apiRequest('/reports', {
      method: 'POST',
      data: {
        rsid: ADOBE_REPORT_SUITE_ID,
        globalFilters,
        metricContainer: {
          metrics: [
            { id: 'metrics/pageviews', columnId: '0' },
            { id: 'metrics/visitors', columnId: '1' }
          ]
        },
        dimension: 'variables/page',
        search: { clause: `CONTAINS '${bracketType}'` },
        settings: { countRepeatInstances: true, limit: 100 }
      }
    });

    const pages = (data?.rows || [])
      .filter(row => !row.value.toLowerCase().includes('fantasy'))
      .map(row => ({
        page: row.value,
        pageViews: row.data?.[0] || 0,
        visitors: row.data?.[1] || 0
      }));

    const totals = pages.reduce((acc, p) => ({
      pageViews: acc.pageViews + p.pageViews,
      visitors: acc.visitors + p.visitors
    }), { pageViews: 0, visitors: 0 });

    return { bracketType, dateRange: { start: startDate, end: endDate }, pages, totals };
  } catch (err) {
    return { bracketType, error: err.message };
  }
}

/**
 * Main function - run the bracket impact analysis
 */
async function runBracketImpactAnalysis() {
  console.log('='.repeat(80));
  console.log('BRACKET PAGE IMPACT ANALYSIS');
  console.log('Redesign Date: February 2023');
  console.log('='.repeat(80));

  // Test auth first
  console.log('\nTesting Adobe Analytics authentication...');
  try {
    const authResult = await testAuth();
    if (!authResult.success) {
      console.error('Auth failed:', authResult);
      return;
    }
    console.log('✓ Authentication successful');
  } catch (err) {
    console.error('Auth error:', err.message);
    return;
  }

  // Define time periods to compare
  // Key events:
  // - March Madness: Mid-March to early April
  // - NBA Playoffs: Mid-April to June
  // - NFL Playoffs: January
  // - MLB Playoffs: October
  // - College Football Playoffs: December-January

  const periods = [
    // March Madness comparison (most relevant)
    { name: 'March Madness 2022 (Pre-redesign)', start: '2022-03-14', end: '2022-04-05' },
    { name: 'March Madness 2023 (Post-redesign)', start: '2023-03-14', end: '2023-04-04' },
    { name: 'March Madness 2024', start: '2024-03-17', end: '2024-04-08' },
    { name: 'March Madness 2025', start: '2025-03-16', end: '2025-04-07' },
    
    // NBA Playoffs
    { name: 'NBA Playoffs 2023', start: '2023-04-15', end: '2023-06-15' },
    { name: 'NBA Playoffs 2024', start: '2024-04-16', end: '2024-06-15' },
    
    // NFL Playoffs
    { name: 'NFL Playoffs 2023 (Jan)', start: '2023-01-14', end: '2023-02-12' },
    { name: 'NFL Playoffs 2024 (Jan)', start: '2024-01-13', end: '2024-02-11' },
    { name: 'NFL Playoffs 2025 (Jan)', start: '2025-01-11', end: '2025-02-09' },
    
    // College Football Playoffs
    { name: 'CFP 2023-24', start: '2023-12-30', end: '2024-01-10' },
    { name: 'CFP 2024-25', start: '2024-12-20', end: '2025-01-20' },
    
    // Recent 90 days for current state
    { name: 'Last 90 Days', start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], end: new Date().toISOString().split('T')[0] }
  ];

  const results = [];
  
  for (const period of periods) {
    const metrics = await getBracketMetrics(period.start, period.end);
    results.push({
      period: period.name,
      ...metrics
    });
    
    // Rate limiting - wait between requests
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Print summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY RESULTS');
  console.log('='.repeat(80));

  for (const result of results) {
    if (result.error) {
      console.log(`\n${result.period}: ERROR - ${result.error}`);
      continue;
    }
    
    console.log(`\n${result.period}:`);
    console.log(`  Date Range: ${result.dateRange.start} to ${result.dateRange.end}`);
    console.log(`  Total Pageviews: ${result.totals?.pageViews?.toLocaleString() || 0}`);
    console.log(`  Unique Visitors: ${result.totals?.visitors?.toLocaleString() || 0}`);
    console.log(`  Pages Tracked: ${result.pageCount || 0}`);
    
    if (result.pages?.length > 0) {
      console.log('  Top Pages:');
      result.pages.slice(0, 5).forEach(p => {
        console.log(`    - ${p.page}: ${p.pageViews.toLocaleString()} views`);
      });
    }
  }

  // Calculate year-over-year growth for key events
  console.log('\n' + '='.repeat(80));
  console.log('YEAR-OVER-YEAR COMPARISON');
  console.log('='.repeat(80));

  const mmResults = results.filter(r => r.period.includes('March Madness') && !r.error);
  if (mmResults.length >= 2) {
    console.log('\nMarch Madness Growth:');
    for (let i = 1; i < mmResults.length; i++) {
      const prev = mmResults[i - 1];
      const curr = mmResults[i];
      const growth = prev.totals?.pageViews > 0 
        ? ((curr.totals?.pageViews - prev.totals?.pageViews) / prev.totals?.pageViews * 100).toFixed(1)
        : 'N/A';
      console.log(`  ${prev.period} → ${curr.period}: ${growth}% growth`);
    }
  }

  const nflResults = results.filter(r => r.period.includes('NFL Playoffs') && !r.error);
  if (nflResults.length >= 2) {
    console.log('\nNFL Playoffs Growth:');
    for (let i = 1; i < nflResults.length; i++) {
      const prev = nflResults[i - 1];
      const curr = nflResults[i];
      const growth = prev.totals?.pageViews > 0 
        ? ((curr.totals?.pageViews - prev.totals?.pageViews) / prev.totals?.pageViews * 100).toFixed(1)
        : 'N/A';
      console.log(`  ${prev.period} → ${curr.period}: ${growth}% growth`);
    }
  }

  // Generate resume bullet points
  console.log('\n' + '='.repeat(80));
  console.log('RESUME BULLET POINTS');
  console.log('='.repeat(80));

  const last90 = results.find(r => r.period === 'Last 90 Days');
  const totalViews = results.reduce((sum, r) => sum + (r.totals?.pageViews || 0), 0);
  const totalVisitors = results.reduce((sum, r) => sum + (r.totals?.visitors || 0), 0);

  console.log('\nSuggested resume bullets based on data:');
  
  if (last90 && !last90.error) {
    console.log(`\n• Redesigned ESPN's bracket visualization system used during major sporting events including March Madness, NFL Playoffs, and NBA Playoffs, serving ${formatNumber(last90.totals?.visitors)} unique visitors in the last 90 days`);
  }

  if (totalViews > 0) {
    console.log(`\n• Built bracket pages that generated ${formatNumber(totalViews)}+ pageviews across March Madness, NFL Playoffs, NBA Playoffs, and College Football Playoffs`);
  }

  // Find biggest tournament
  const biggestEvent = results
    .filter(r => !r.error && r.totals?.pageViews > 0)
    .sort((a, b) => b.totals.pageViews - a.totals.pageViews)[0];
  
  if (biggestEvent) {
    console.log(`\n• ${biggestEvent.period} bracket pages alone drove ${formatNumber(biggestEvent.totals.pageViews)} pageviews and ${formatNumber(biggestEvent.totals.visitors)} unique visitors`);
  }

  return results;
}

function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(0) + 'K';
  return num.toString();
}

// Run the analysis
runBracketImpactAnalysis()
  .then(results => {
    console.log('\n✓ Analysis complete');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n✗ Analysis failed:', err);
    process.exit(1);
  });

