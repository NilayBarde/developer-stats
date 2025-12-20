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

function GitSection({ githubStats, gitlabStats, compact = false }) {
  // Determine if we're showing single source or combined
  const showGitHubOnly = githubStats && !gitlabStats;
  const showGitLabOnly = gitlabStats && !githubStats;
  
  // Show error only if both sources have errors (or single source has error)
  const hasError = (githubStats?.error && gitlabStats?.error) || 
                  (showGitHubOnly && githubStats?.error) ||
                  (showGitLabOnly && gitlabStats?.error);
  const hasData = !hasError && (githubStats || gitlabStats);
  
  if (!hasData) {
    // Show error if both failed, otherwise show nothing (one might be missing)
    if (hasError) {
      return (
        <>
          {githubStats?.error && renderErrorSection('github', '📦', githubStats.error)}
          {gitlabStats?.error && renderErrorSection('gitlab', '🔷', gitlabStats.error)}
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
  
  // Convert combined monthly objects to arrays
  const monthlyPRsArray = Object.entries(combinedMonthlyPRs)
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const totalPRs = (githubStats?.total || 0) + (gitlabStats?.total || 0);
  const totalMerged = (githubStats?.merged || 0) + (gitlabStats?.merged || 0);
  const totalOpen = (githubStats?.open || 0) + (gitlabStats?.open || 0);
  const totalLast30Days = (githubStats?.last30Days || 0) + (gitlabStats?.last30Days || 0);
  
  // Combine repo breakdowns
  const githubRepos = githubStats?.repoBreakdown || [];
  const gitlabRepos = gitlabStats?.repoBreakdown || [];
  const combinedRepos = [...githubRepos.map(r => ({ ...r, source: 'github' })), ...gitlabRepos.map(r => ({ ...r, source: 'gitlab' }))];
  const totalReposAuthored = (githubStats?.reposAuthored || 0) + (gitlabStats?.reposAuthored || 0);
  
  // Combine PRs/MRs lists - add source indicator
  const combinedPRs = combinePRLists(githubStats?.prs, gitlabStats?.mrs).map(pr => ({
    ...pr,
    _source: pr.html_url || pr.repository_url ? 'github' : 'gitlab'
  }));

  // Determine title
  const title = showGitHubOnly ? '📦 GitHub' : showGitLabOnly ? '🔷 GitLab' : '🔀 Git (GitHub + GitLab)';

  return (
    <div className="source-section">
      <h2>{title}</h2>
      
      {/* Show individual errors if one source failed */}
      {githubStats?.error && !gitlabStats?.error && renderErrorSection('github', '📦', githubStats.error)}
      {gitlabStats?.error && !githubStats?.error && renderErrorSection('gitlab', '🔷', gitlabStats.error)}
      
      <div className="cards-grid">
        <StatsCard
          title={showGitHubOnly ? "Total PRs" : showGitLabOnly ? "Total MRs" : "Total PRs/MRs"}
          value={totalPRs}
          subtitle={`${totalLast30Days} in last 30 days`}
        />
        <StatsCard
          title="Merged"
          value={totalMerged}
          subtitle={`${totalOpen} open`}
        />
        {(combined.avgPRsPerMonth !== undefined || githubStats?.avgPRsPerMonth || gitlabStats?.avgMRsPerMonth) && (
          <StatsCard
            title={showGitHubOnly ? "Avg PRs per Month" : showGitLabOnly ? "Avg MRs per Month" : "Avg PRs/MRs per Month"}
            value={combined.avgPRsPerMonth || githubStats?.avgPRsPerMonth || gitlabStats?.avgMRsPerMonth || 0}
            subtitle="Monthly average"
          />
        )}
        <StatsCard
          title="Repos Authored"
          value={totalReposAuthored}
          subtitle={`${combinedRepos.length} total repos`}
        />
      </div>
      
      {/* Repo Breakdown */}
      {!compact && combinedRepos.length > 0 && (
        <div className="repo-breakdown">
          <h3>Repository Breakdown</h3>
          <div className="repo-list">
            {combinedRepos.slice(0, 10).map((repo, index) => (
              <div key={index} className="repo-item">
                <div className="repo-name">
                  <span className={`source-badge source-${repo.source}`}>
                    {repo.source === 'github' ? '📦' : '🔷'}
                  </span>
                  {repo.repo}
                </div>
                <div className="repo-stats">
                  <span className="repo-stat">{repo.total} total</span>
                  {repo.merged > 0 && <span className="repo-stat merged">{repo.merged} merged</span>}
                  {repo.open > 0 && <span className="repo-stat open">{repo.open} open</span>}
                </div>
              </div>
            ))}
            {combinedRepos.length > 10 && (
              <div className="repo-more">+ {combinedRepos.length - 10} more repos</div>
            )}
          </div>
        </div>
      )}
      
      {!compact && (
        <>
          <ChartWithFallback
            data={monthlyPRsArray}
            title="PRs/MRs per Month"
            emptyMessage="No PR/MR data available for the selected date range"
          />
          
          {combinedPRs.length > 0 && (
            <PRList 
              prs={combinedPRs} 
              source="combined"
            />
          )}
        </>
      )}
    </div>
  );
}

export default GitSection;

