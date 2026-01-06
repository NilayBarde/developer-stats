/**
 * Combine monthly data from multiple sources
 * Returns an object with month as key and combined count as value
 */
export function combineMonthlyData(...sources) {
  const combined = {};
  sources.forEach(source => {
    if (Array.isArray(source)) {
      source.forEach(item => {
        if (!combined[item.month]) {
          combined[item.month] = 0;
        }
        combined[item.month] += item.count || 0;
      });
    }
  });
  return combined;
}

/**
 * Convert combined monthly object to array format
 */
export function monthlyObjectToArray(monthlyObj) {
  return Object.entries(monthlyObj)
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Calculate average from monthly data (only months with data)
 */
export function calculateAverage(monthlyData) {
  const monthsWithData = Object.values(monthlyData).filter(count => count > 0);
  if (monthsWithData.length === 0) return 0;
  return (monthsWithData.reduce((a, b) => a + b, 0) / monthsWithData.length).toFixed(1);
}

/**
 * Get comparison text for PRs/MRs
 * @param {number} avgPRs - Average PRs per month
 * @param {Object|null} benchmarks - Dynamic benchmarks object from API, or null
 */
export function getPRComparison(avgPRs, benchmarks = null) {
  if (!benchmarks) return '';
  
  const fteAvg = benchmarks?.fte?.avgPRsPerMonth;
  const p2Avg = benchmarks?.p2?.avgPRsPerMonth;
  
  const parts = [];
  if (fteAvg !== null && fteAvg !== undefined) {
    parts.push(`FTE: ${fteAvg}`);
  }
  if (p2Avg !== null && p2Avg !== undefined) {
    parts.push(`P2: ${p2Avg}`);
  }
  
  return parts.length > 0 ? parts.join(' | ') : '';
}

/**
 * Combine PR/MR lists from multiple sources
 */
export function combinePRLists(...sources) {
  const combined = [];
  sources.forEach(source => {
    if (Array.isArray(source)) {
      combined.push(...source);
    }
  });
  // Sort by updated date (most recent first)
  return combined.sort((a, b) => {
    const dateA = new Date(a.updated_at || a.created_at || 0);
    const dateB = new Date(b.updated_at || b.created_at || 0);
    return dateB.getTime() - dateA.getTime();
  });
}

/**
 * Calculate combined stats from GitHub and GitLab data
 * Uses engineering-metrics aligned `created` field for totals,
 * and monthly PR/MR data for averages
 */
export function calculateCombinedStats(githubStats, gitlabStats) {
  const githubPRs = githubStats?.monthlyPRs || [];
  const gitlabMRs = gitlabStats?.monthlyMRs || [];
  
  const combinedMonthly = combineMonthlyData(githubPRs, gitlabMRs);
  
  const avgPRsPerMonth = calculateAverage(combinedMonthly);
  
  // Use engineering-metrics aligned `created` field if available, fallback to `total`
  // If created is 0 but total exists, use total (GraphQL contributionsCollection might miss some PRs)
  const githubCreated = githubStats?.created > 0 ? githubStats.created : (githubStats?.total ?? 0);
  const gitlabCreated = gitlabStats?.created ?? gitlabStats?.total ?? 0;
  const totalPRs = githubCreated + gitlabCreated;
  
  return {
    totalPRs,
    avgPRsPerMonth,
    // Individual platform counts for subtitle
    githubCount: githubCreated,
    gitlabCount: gitlabCreated
  };
}

