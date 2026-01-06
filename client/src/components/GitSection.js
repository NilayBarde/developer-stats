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
  const githubReviews = githubStats?.reviews || githubStats?.contributions?.totalPRReviews || 0;
  
  // GitLab stats (engineering-metrics format: commented, created, merged, approved)
  const gitlabCommented = gitlabStats?.commented || 0;
  const gitlabCreated = gitlabStats?.created || gitlabStats?.total || 0;
  const gitlabMerged = gitlabStats?.merged || 0;
  const gitlabApproved = gitlabStats?.approved || 0;

  // Combined totals
  const totalCreated = githubCreated + gitlabCreated;
  const totalReviews = githubReviews + gitlabCommented + gitlabApproved;

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
              title="Reviews/Comments"
              value={totalReviews}
              subtitle="PR reviews + MR comments/approvals"
            />
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
              title="PR Reviews"
              value={githubReviews}
              subtitle="totalPullRequestReviewContributions"
            />
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
              title="Commented"
              value={gitlabCommented}
              subtitle="MR comment events"
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
            <StatsCard
              title="Approved"
              value={gitlabApproved}
              subtitle="MR approval events"
            />
          </div>
        </>
      )}
    </div>
  );
}

export default GitSection;
