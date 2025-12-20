// Reference averages (Oct-Jul period)
export const BENCHMARKS = {
  FTE_AVG_PR_PER_MONTH: 9.4,
  P2_AVG_PR_PER_MONTH: 8.6
};

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
 */
export function getPRComparison(avgPRs) {
  const { FTE_AVG_PR_PER_MONTH, P2_AVG_PR_PER_MONTH } = BENCHMARKS;
  return `FTE: ${FTE_AVG_PR_PER_MONTH} | P2: ${P2_AVG_PR_PER_MONTH}`;
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
 */
export function calculateCombinedStats(githubStats, gitlabStats) {
  const githubPRs = githubStats?.monthlyPRs || [];
  const gitlabMRs = gitlabStats?.monthlyMRs || [];
  
  const combinedMonthly = combineMonthlyData(githubPRs, gitlabMRs);
  
  const avgPRsPerMonth = calculateAverage(combinedMonthly);
  
  const totalPRs = (githubStats?.total || 0) + (gitlabStats?.total || 0);
  
  return {
    totalPRs,
    avgPRsPerMonth
  };
}

