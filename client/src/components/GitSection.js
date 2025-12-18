import React from 'react';
import StatsCard from './StatsCard';
import ChartWithFallback from './ChartWithFallback';
import PRList from './PRList';
import { calculateCombinedStats, combineMonthlyData } from '../utils/combinedStats';
import { renderErrorSection } from '../utils/sectionHelpers';

/**
 * Combine PRs/MRs lists from GitHub and GitLab
 */
function combinePRLists(githubPRs = [], gitlabMRs = []) {
  const combined = [...(githubPRs || []), ...(gitlabMRs || [])];
  // Sort by updated date (most recent first)
  return combined.sort((a, b) => {
    // GitHub uses updated_at, GitLab uses updated_at, fallback to created_at
    const dateA = new Date(a.updated_at || a.created_at || 0);
    const dateB = new Date(b.updated_at || b.created_at || 0);
    return dateB.getTime() - dateA.getTime();
  });
}

/**
 * Calculate average time to merge from combined sources
 */
function calculateCombinedAvgTimeToMerge(githubStats, gitlabStats) {
  const githubTotal = githubStats?.total || 0;
  const gitlabTotal = gitlabStats?.total || 0;
  const total = githubTotal + gitlabTotal;
  
  if (total === 0) return 0;
  
  const githubAvg = githubStats?.avgTimeToMerge || 0;
  const gitlabAvg = gitlabStats?.avgTimeToMerge || 0;
  
  // Weighted average
  return ((githubAvg * githubTotal) + (gitlabAvg * gitlabTotal)) / total;
}

function GitSection({ githubStats, gitlabStats }) {
  // Show error only if both sources have errors
  const hasError = githubStats?.error && gitlabStats?.error;
  const hasData = !hasError && (githubStats || gitlabStats);
  
  if (!hasData) {
    // Show error if both failed, otherwise show nothing (one might be missing)
    if (hasError) {
      return (
        <>
          {renderErrorSection('github', '📦', githubStats?.error)}
          {renderErrorSection('gitlab', '🔷', gitlabStats?.error)}
        </>
      );
    }
    return null;
  }

  const combined = calculateCombinedStats(githubStats, gitlabStats);
  
  // Combine monthly data for charts
  const combinedMonthlyPRs = combineMonthlyData(
    githubStats?.monthlyPRs || [],
    gitlabStats?.monthlyMRs || []
  );
  const combinedMonthlyComments = combineMonthlyData(
    githubStats?.monthlyComments || [],
    gitlabStats?.monthlyComments || []
  );
  
  // Convert combined monthly objects to arrays
  const monthlyPRsArray = Object.entries(combinedMonthlyPRs)
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));
  
  const monthlyCommentsArray = Object.entries(combinedMonthlyComments)
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const totalPRs = (githubStats?.total || 0) + (gitlabStats?.total || 0);
  const totalMerged = (githubStats?.merged || 0) + (gitlabStats?.merged || 0);
  const totalOpen = (githubStats?.open || 0) + (gitlabStats?.open || 0);
  const totalLast30Days = (githubStats?.last30Days || 0) + (gitlabStats?.last30Days || 0);
  const avgTimeToMerge = calculateCombinedAvgTimeToMerge(githubStats, gitlabStats);
  
  // Combine PRs/MRs lists - add source indicator
  const combinedPRs = combinePRLists(githubStats?.prs, gitlabStats?.mrs).map(pr => ({
    ...pr,
    _source: pr.html_url || pr.repository_url ? 'github' : 'gitlab'
  }));

  return (
    <div className="source-section">
      <h2>🔀 Git (GitHub + GitLab)</h2>
      
      {/* Show individual errors if one source failed */}
      {githubStats?.error && !gitlabStats?.error && renderErrorSection('github', '📦', githubStats.error)}
      {gitlabStats?.error && !githubStats?.error && renderErrorSection('gitlab', '🔷', gitlabStats.error)}
      
      <div className="cards-grid">
        <StatsCard
          title="Total PRs/MRs"
          value={totalPRs}
          subtitle={`${totalLast30Days} in last 30 days`}
        />
        <StatsCard
          title="Merged"
          value={totalMerged}
          subtitle={`${totalOpen} open`}
        />
        <StatsCard
          title="Avg Time to Merge"
          value={`${avgTimeToMerge.toFixed(1)} days`}
          subtitle="Weighted average"
        />
        {combined.avgPRsPerMonth !== undefined && (
          <StatsCard
            title="Avg PRs/MRs per Month"
            value={combined.avgPRsPerMonth}
            subtitle="Monthly average"
          />
        )}
        {combined.totalComments > 0 && (
          <StatsCard
            title="Total Comments"
            value={combined.totalComments}
            subtitle={`Avg: ${combined.avgCommentsPerMonth}/month`}
          />
        )}
      </div>
      
      <ChartWithFallback
        data={monthlyPRsArray}
        title="PRs/MRs per Month"
        emptyMessage="No PR/MR data available for the selected date range"
      />
      
      <ChartWithFallback
        data={monthlyCommentsArray}
        title="Comments per Month"
        emptyMessage="No comment data available for the selected date range"
      />
      
      {combinedPRs.length > 0 && (
        <PRList 
          prs={combinedPRs} 
          source="combined"
        />
      )}
    </div>
  );
}

export default GitSection;

