// Reference averages (Oct-Jul period)
export const BENCHMARKS = {
  FTE_AVG_PR_PER_MONTH: 9.4,
  P2_AVG_PR_PER_MONTH: 8.6,
  FTE_AVG_COMMENTS_PER_MONTH: 41.6,
  P2_AVG_COMMENTS_PER_MONTH: 28.2
};

/**
 * Combine monthly data from multiple sources
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
 * Get comparison text for comments
 */
export function getCommentsComparison(avgComments) {
  const { FTE_AVG_COMMENTS_PER_MONTH, P2_AVG_COMMENTS_PER_MONTH } = BENCHMARKS;
  return `FTE: ${FTE_AVG_COMMENTS_PER_MONTH} | P2: ${P2_AVG_COMMENTS_PER_MONTH}`;
}

/**
 * Calculate combined stats from GitHub and GitLab data
 */
export function calculateCombinedStats(githubStats, gitlabStats) {
  const githubPRs = githubStats?.monthlyPRs || [];
  const gitlabMRs = gitlabStats?.monthlyMRs || [];
  const githubComments = githubStats?.monthlyComments || [];
  const gitlabComments = gitlabStats?.monthlyComments || [];
  
  const combinedMonthly = combineMonthlyData(githubPRs, gitlabMRs);
  const combinedCommentsMonthly = combineMonthlyData(githubComments, gitlabComments);
  
  const avgPRsPerMonth = calculateAverage(combinedMonthly);
  const avgCommentsPerMonth = calculateAverage(combinedCommentsMonthly);
  
  const totalPRs = (githubStats?.total || 0) + (gitlabStats?.total || 0);
  const totalComments = Object.values(combinedCommentsMonthly).reduce((a, b) => a + b, 0);
  
  return {
    totalPRs,
    avgPRsPerMonth,
    totalComments,
    avgCommentsPerMonth
  };
}

