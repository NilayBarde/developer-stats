import React from 'react';
import StatsCard from './StatsCard';
import { renderErrorSection } from '../utils/sectionHelpers';

/**
 * GitSection - displays GitHub and GitLab stats in engineering-metrics format
 * 
 * GitHub metrics: created (PRs), reviews
 * GitLab metrics: commented, created, merged, approved
 */
function GitSection({ githubStats, gitlabStats, reviewStats, dateRange, compact = false }) {
  // Show error only if both sources have errors (or single source has error)
  const showGitHubOnly = githubStats && !gitlabStats;
  const showGitLabOnly = gitlabStats && !githubStats;
  
  const hasError = (githubStats?.error && gitlabStats?.error) || 
                  (showGitHubOnly && githubStats?.error) ||
                  (showGitLabOnly && gitlabStats?.error);
  const hasData = !hasError && (githubStats || gitlabStats);
  
  if (!hasData) {
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

  // GitHub stats (engineering-metrics format: created, reviews)
  const githubCreated = githubStats?.created || githubStats?.total || 0;
  const githubReviews = reviewStats?.github?.prsReviewed || githubStats?.reviews || githubStats?.contributions?.totalPRReviews || 0;
  const githubComments = reviewStats?.github?.totalComments || 0;
  
  // GitLab stats (engineering-metrics format: commented, created, merged, approved)
  const gitlabCreated = gitlabStats?.created || gitlabStats?.total || 0;
  const gitlabMerged = gitlabStats?.merged || 0;
  const gitlabReviews = reviewStats?.gitlab?.mrsReviewed || 0;
  const gitlabComments = reviewStats?.gitlab?.totalComments || 0;

  // Combined totals
  const totalCreated = githubCreated + gitlabCreated;
  const totalReviews = githubReviews + gitlabReviews;
  const totalComments = githubComments + gitlabComments;
  
  // Calculate comments per month
  const githubCommentsPerMonth = reviewStats?.github?.avgCommentsPerMonth || 0;
  const gitlabCommentsPerMonth = reviewStats?.gitlab?.avgCommentsPerMonth || 0;
  const combinedCommentsPerMonth = githubCommentsPerMonth + gitlabCommentsPerMonth;

  // Determine title
  const title = showGitHubOnly ? 'GitHub' : showGitLabOnly ? 'GitLab' : 'Git (GitHub + GitLab)';

  return (
    <div className="source-section">
      <h2>{title}</h2>
      
      {/* Show individual errors if one source failed */}
      {githubStats?.error && !gitlabStats?.error && renderErrorSection('github', '', githubStats.error)}
      {gitlabStats?.error && !githubStats?.error && renderErrorSection('gitlab', '', gitlabStats.error)}
      
      {/* Combined Overview */}
      {!showGitHubOnly && !showGitLabOnly && (
        <>
          <h3 style={{ marginTop: '0', marginBottom: '12px', color: 'var(--text-secondary, #666)' }}>Combined</h3>
          <div className="cards-grid">
            <StatsCard
              title="PRs/MRs Created"
              value={totalCreated}
              subtitle="Total contributions"
            />
            <StatsCard
              title="Reviews"
              value={totalReviews}
              subtitle="PRs/MRs reviewed (not authored by you)"
            />
            <StatsCard
              title="Comments"
              value={totalComments}
              subtitle="Total comments made on PRs/MRs"
            />
            {combinedCommentsPerMonth > 0 && (
              <StatsCard
                title="Comments per Month"
                value={combinedCommentsPerMonth.toFixed(1)}
                subtitle={(() => {
                  const parts = [];
                  if (githubCommentsPerMonth > 0) parts.push(`${githubCommentsPerMonth.toFixed(1)} GitHub`);
                  if (gitlabCommentsPerMonth > 0) parts.push(`${gitlabCommentsPerMonth.toFixed(1)} GitLab`);
                  return parts.join(', ') || 'Average comments per month';
                })()}
              />
            )}
          </div>
        </>
      )}
      
      {/* GitHub Section - matches engineering-metrics format */}
      {githubStats && !githubStats.error && (
        <>
          <h3 style={{ marginTop: '24px', marginBottom: '12px', color: 'var(--text-secondary, #666)' }}>
            GitHub {githubStats.username && <span style={{ fontWeight: 'normal', fontSize: '0.85em' }}>(@{githubStats.username})</span>}
          </h3>
          <div className="cards-grid">
            <StatsCard
              title="PRs Created"
              value={githubCreated}
              subtitle="totalPullRequestContributions"
            />
            <StatsCard
              title="PRs Reviewed"
              value={githubReviews}
              subtitle="PRs reviewed (not authored by you)"
            />
            <StatsCard
              title="Comments"
              value={githubComments}
              subtitle="Total comments made on PRs"
            />
            {githubCommentsPerMonth > 0 && (
              <StatsCard
                title="Comments per Month"
                value={githubCommentsPerMonth.toFixed(1)}
                subtitle="Average comments per month"
              />
            )}
            {githubStats.totalCommits > 0 && (
              <StatsCard
                title="Commits"
                value={githubStats.totalCommits}
                subtitle="totalCommitContributions"
              />
            )}
          </div>
          
          {/* PRs by Repo breakdown */}
          {!compact && githubStats.prsByRepo && githubStats.prsByRepo.length > 0 && (
            <div className="repo-breakdown">
              <h4>PRs by Repository</h4>
              <div className="repo-list">
                {githubStats.prsByRepo.slice(0, 8).map((item, index) => (
                  <div key={index} className="repo-item">
                    <div className="repo-name">
                      <span className="source-badge source-github">GH</span>
                      {item.repo}
                    </div>
                    <div className="repo-stats">
                      <span className="repo-stat">{item.count} PRs</span>
                    </div>
                  </div>
                ))}
                {githubStats.prsByRepo.length > 8 && (
                  <div className="repo-more">+ {githubStats.prsByRepo.length - 8} more repos</div>
                )}
              </div>
            </div>
          )}
        </>
      )}
      
      {/* GitLab Section - matches engineering-metrics format */}
      {gitlabStats && !gitlabStats.error && (
        <>
          <h3 style={{ marginTop: '24px', marginBottom: '12px', color: 'var(--text-secondary, #666)' }}>
            GitLab {gitlabStats.username && <span style={{ fontWeight: 'normal', fontSize: '0.85em' }}>(@{gitlabStats.username})</span>}
          </h3>
          <div className="cards-grid">
            <StatsCard
              title="MRs Reviewed"
              value={gitlabReviews}
              subtitle="MRs reviewed (not authored by you)"
            />
            <StatsCard
              title="Comments"
              value={gitlabComments}
              subtitle="Total comments made on MRs"
            />
            <StatsCard
              title="Created"
              value={gitlabCreated}
              subtitle="MR creation events"
            />
            <StatsCard
              title="Merged"
              value={gitlabMerged}
              subtitle="MR merge events"
            />
            {gitlabCommentsPerMonth > 0 && (
              <StatsCard
                title="Comments per Month"
                value={gitlabCommentsPerMonth.toFixed(1)}
                subtitle="Average comments per month"
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default GitSection;
