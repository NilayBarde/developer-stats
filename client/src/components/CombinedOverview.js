import React from 'react';
import StatsCard from './StatsCard';
import Skeleton from './ui/Skeleton';
import { calculateCombinedStats, getPRComparison } from '../utils/combinedStats';
import { formatVelocitySubtitle } from '../utils/velocityHelpers';

function CombinedOverview({ githubStats, gitlabStats, jiraStats, gitLoading = false, jiraLoading = false, dateRange = null, benchmarks = null, benchmarksLoading = false, reviewStats = null }) {

  // Don't show if all sources have errors
  if (githubStats?.error && gitlabStats?.error && jiraStats?.error) {
    return null;
  }

  const combined = calculateCombinedStats(githubStats, gitlabStats);
  const combinedVelocity = jiraStats?.velocity?.combinedAverageVelocity || jiraStats?.velocity?.averageVelocity || 0;
  
  // Calculate combined reviews and comments
  const githubReviews = reviewStats?.github?.prsReviewed || githubStats?.reviews || 0;
  const gitlabReviews = reviewStats?.gitlab?.mrsReviewed || 0;
  const totalReviews = githubReviews + gitlabReviews;
  
  const githubComments = reviewStats?.github?.totalComments || 0;
  const gitlabComments = reviewStats?.gitlab?.totalComments || 0;
  const totalComments = githubComments + gitlabComments;
  
  // Calculate comments per month
  const githubCommentsPerMonth = reviewStats?.github?.avgCommentsPerMonth || 0;
  const gitlabCommentsPerMonth = reviewStats?.gitlab?.avgCommentsPerMonth || 0;
  const combinedCommentsPerMonth = githubCommentsPerMonth + gitlabCommentsPerMonth;

  // Helper to render total PRs subtitle with benchmarks
  const renderTotalPRsSubtitle = () => {
    if (benchmarksLoading) {
      return <span className="benchmarks-loading">Loading benchmarks...</span>;
    }
    
    const parts = [`${combined.githubCount} GitHub, ${combined.gitlabCount} GitLab`];
    
    if (benchmarks) {
      const fteTotal = benchmarks?.fte?.totalPRs;
      const p2Total = benchmarks?.p2?.totalPRs;
      
      const benchmarkParts = [];
      if (fteTotal !== null && fteTotal !== undefined) {
        benchmarkParts.push(`FTE: ${fteTotal}`);
      }
      if (p2Total !== null && p2Total !== undefined) {
        benchmarkParts.push(`P2: ${p2Total}`);
      }
      
      if (benchmarkParts.length > 0) {
        parts.push(benchmarkParts.join(' | '));
      }
    }
    
    return parts.join(' | ');
  };

  // Helper to render subtitle with loading state for PR comparison
  const renderPRSubtitle = (content) => {
    if (benchmarksLoading && !content) {
      return <span className="benchmarks-loading">Loading benchmarks...</span>;
    }
    return content;
  };

  // Helper to render velocity subtitle with loading state
  const renderVelocitySubtitle = () => {
    if (benchmarksLoading) {
      return <span className="benchmarks-loading">Loading benchmarks...</span>;
    }
    return formatVelocitySubtitle(combinedVelocity, jiraStats?.velocity?.totalSprints, benchmarks);
  };

  return (
    <div className="source-section combined">
      <h2>Combined Overview</h2>
      <div className="cards-grid">
        {gitLoading ? (
          <Skeleton variant="stat-card" />
        ) : (
          <StatsCard
            title="Total PRs/MRs"
            value={combined.totalPRs}
            subtitle={renderTotalPRsSubtitle()}
          />
        )}
        {gitLoading ? (
          <Skeleton variant="stat-card" />
        ) : (
          <StatsCard
            title="Avg PRs/MRs per Month"
            value={combined.avgPRsPerMonth}
            subtitle={renderPRSubtitle(getPRComparison(combined.avgPRsPerMonth, benchmarks))}
          />
        )}
        {gitLoading ? (
          <Skeleton variant="stat-card" />
        ) : totalReviews > 0 ? (
          <StatsCard
            title="Reviews"
            value={totalReviews}
            subtitle={`${githubReviews} GitHub, ${gitlabReviews} GitLab`}
          />
        ) : null}
        {gitLoading ? (
          <Skeleton variant="stat-card" />
        ) : totalComments > 0 ? (
          <StatsCard
            title="Comments"
            value={totalComments}
            subtitle={`${githubComments} GitHub, ${gitlabComments} GitLab`}
          />
        ) : null}
        {gitLoading ? (
          <Skeleton variant="stat-card" />
        ) : combinedCommentsPerMonth > 0 ? (
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
        ) : null}
        {jiraLoading ? (
          <Skeleton variant="stat-card" />
        ) : combinedVelocity > 0 ? (
          <StatsCard
            title="Average Velocity per Sprint"
            value={combinedVelocity}
            subtitle={renderVelocitySubtitle()}
          />
        ) : null}
      </div>
    </div>
  );
}

export default CombinedOverview;

