import React from 'react';
import StatsCard from './StatsCard';
import Skeleton from './ui/Skeleton';
import { calculateCombinedStats, getPRComparison } from '../utils/combinedStats';
import { formatVelocitySubtitle } from '../utils/velocityHelpers';

function CombinedOverview({ githubStats, gitlabStats, jiraStats, gitLoading = false, jiraLoading = false, dateRange = null, benchmarks = null, benchmarksLoading = false }) {

  // Don't show if all sources have errors
  if (githubStats?.error && gitlabStats?.error && jiraStats?.error) {
    return null;
  }

  const combined = calculateCombinedStats(githubStats, gitlabStats);
  const combinedVelocity = jiraStats?.velocity?.combinedAverageVelocity || jiraStats?.velocity?.averageVelocity || 0;

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

