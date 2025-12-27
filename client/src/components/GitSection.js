import React from 'react';
import StatsCard from './StatsCard';
import ChartWithFallback from './ChartWithFallback';
import PRList from './PRList';
import { calculateCombinedStats, combineMonthlyData, combinePRLists } from '../utils/combinedStats';
import { renderErrorSection } from '../utils/sectionHelpers';

function GitSection({ githubStats, gitlabStats, reviewStats, dateRange, compact = false }) {
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
          {githubStats?.error && renderErrorSection('github', '', githubStats.error)}
          {gitlabStats?.error && renderErrorSection('gitlab', '', gitlabStats.error)}
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
  
  // Combine monthly merged data
  const combinedMonthlyMerged = combineMonthlyData(
    githubStats?.monthlyMerged || [],
    gitlabStats?.monthlyMerged || []
  );
  
  // Filter to only show months within the selected date range
  const prStartMonth = dateRange?.start?.substring(0, 7);
  const prEndMonth = dateRange?.end?.substring(0, 7);
  
  // Convert combined monthly objects to arrays (filtered by date range)
  const monthlyPRsArray = Object.entries(combinedMonthlyPRs)
    .filter(([month]) => {
      if (prStartMonth && month < prStartMonth) return false;
      if (prEndMonth && month > prEndMonth) return false;
      return true;
    })
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));
  
  // Monthly merged array (filtered by date range)
  const monthlyMergedArray = Object.entries(combinedMonthlyMerged)
    .filter(([month]) => {
      if (prStartMonth && month < prStartMonth) return false;
      if (prEndMonth && month > prEndMonth) return false;
      return true;
    })
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

  // Review stats (comments on others' PRs/MRs)
  const githubReviewStats = reviewStats?.github || {};
  const gitlabReviewStats = reviewStats?.gitlab || {};
  const totalReviewComments = (githubReviewStats.totalComments || 0) + (gitlabReviewStats.totalComments || 0);
  const totalPRsReviewed = (githubReviewStats.prsReviewed || 0) + (gitlabReviewStats.mrsReviewed || 0);
  
  // Calculate avg comments per month from monthly data
  const githubMonthlyComments = githubReviewStats.monthlyComments || {};
  const gitlabMonthlyComments = gitlabReviewStats.monthlyComments || {};
  const allMonths = new Set([...Object.keys(githubMonthlyComments), ...Object.keys(gitlabMonthlyComments)]);
  
  // Filter to only show months within the selected date range
  const startMonth = dateRange?.start?.substring(0, 7);
  const endMonth = dateRange?.end?.substring(0, 7);
  const filteredMonths = Array.from(allMonths).filter(month => {
    if (startMonth && month < startMonth) return false;
    if (endMonth && month > endMonth) return false;
    return true;
  });
  
  const numMonths = filteredMonths.length || 1;
  const filteredTotalComments = filteredMonths.reduce((sum, month) => 
    sum + (githubMonthlyComments[month] || 0) + (gitlabMonthlyComments[month] || 0), 0);
  const avgCommentsPerMonth = Math.round((filteredTotalComments / numMonths) * 10) / 10;
  
  // Combine monthly comments for chart (filtered)
  const combinedMonthlyComments = {};
  for (const month of filteredMonths) {
    combinedMonthlyComments[month] = (githubMonthlyComments[month] || 0) + (gitlabMonthlyComments[month] || 0);
  }
  const monthlyCommentsArray = Object.entries(combinedMonthlyComments)
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));
  
  // Combine review repo breakdowns
  const githubReviewRepos = githubReviewStats.byRepo || [];
  const gitlabReviewRepos = gitlabReviewStats.byRepo || [];
  const combinedReviewRepos = [
    ...githubReviewRepos.map(r => ({ ...r, source: 'github' })), 
    ...gitlabReviewRepos.map(r => ({ ...r, source: 'gitlab' }))
  ].sort((a, b) => b.comments - a.comments);
  
  // Combine PRs/MRs lists - add source indicator
  const combinedPRs = combinePRLists(githubStats?.prs, gitlabStats?.mrs).map(pr => ({
    ...pr,
    _source: pr.html_url || pr.repository_url ? 'github' : 'gitlab'
  }));

  // Determine title
  const title = showGitHubOnly ? 'GitHub' : showGitLabOnly ? 'GitLab' : 'Git (GitHub + GitLab)';

  return (
    <div className="source-section">
      <h2>{title}</h2>
      
      {/* Show individual errors if one source failed */}
      {githubStats?.error && !gitlabStats?.error && renderErrorSection('github', '', githubStats.error)}
      {gitlabStats?.error && !githubStats?.error && renderErrorSection('gitlab', '', gitlabStats.error)}
      
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
      
      {/* MR Comments Section */}
      {(totalReviewComments > 0 || totalPRsReviewed > 0) && (
        <>
          <h3 style={{ marginTop: '24px', marginBottom: '12px', color: 'var(--text-secondary, #666)' }}>MR/PR Comments Authored</h3>
          <div className="cards-grid">
            <StatsCard
              title="MRs/PRs Commented On"
              value={totalPRsReviewed}
              subtitle="Unique PRs/MRs"
            />
            <StatsCard
              title="Comments/Month"
              value={avgCommentsPerMonth}
              subtitle="Average per month"
            />
            <StatsCard
              title="Total Comments"
              value={totalReviewComments}
              subtitle="All comments authored"
            />
          </div>
          
          {/* Review Comments by Month Chart */}
          {!compact && monthlyCommentsArray.length > 0 && (
            <ChartWithFallback
              data={monthlyCommentsArray}
              title="MR/PR Comments per Month"
              emptyMessage="No comment data available"
            />
          )}
        </>
      )}
      
      {/* Repo Breakdown */}
      {!compact && combinedRepos.length > 0 && (
        <div className="repo-breakdown">
          <h3>Repository Breakdown (Authored)</h3>
          <div className="repo-list">
            {combinedRepos.slice(0, 10).map((repo, index) => (
              <div key={index} className="repo-item">
                <div className="repo-name">
                  <span className={`source-badge source-${repo.source}`}>
                    {repo.source === 'github' ? 'GH' : 'GL'}
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
      
      {/* Review Repo Breakdown */}
      {!compact && combinedReviewRepos.length > 0 && (
        <div className="repo-breakdown">
          <h3>Repository Breakdown (Reviews)</h3>
          <div className="repo-list">
            {combinedReviewRepos.slice(0, 10).map((repo, index) => (
              <div key={index} className="repo-item">
                <div className="repo-name">
                  <span className={`source-badge source-${repo.source}`}>
                    {repo.source === 'github' ? 'GH' : 'GL'}
                  </span>
                  {repo.repo}
                </div>
                <div className="repo-stats">
                  <span className="repo-stat">{repo.prsReviewed || repo.mrsReviewed || 0} MRs</span>
                  <span className="repo-stat">{repo.comments} comments</span>
                </div>
              </div>
            ))}
            {combinedReviewRepos.length > 10 && (
              <div className="repo-more">+ {combinedReviewRepos.length - 10} more repos</div>
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
          
          <ChartWithFallback
            data={monthlyMergedArray}
            title="PRs/MRs Merged per Month"
            emptyMessage="No merged PR/MR data available for the selected date range"
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

