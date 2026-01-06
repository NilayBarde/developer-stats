import React from 'react';
import StatsCard from './StatsCard';
import Skeleton from './ui/Skeleton';
import { calculateCombinedStats, getPRComparison } from '../utils/combinedStats';
import { formatVelocitySubtitle } from '../utils/velocityHelpers';

function CombinedOverview({ githubStats, gitlabStats, jiraStats, gitLoading = false, jiraLoading = false }) {
  // Don't show if all sources have errors
  if (githubStats?.error && gitlabStats?.error && jiraStats?.error) {
    return null;
  }

  const combined = calculateCombinedStats(githubStats, gitlabStats);
  const combinedVelocity = jiraStats?.velocity?.combinedAverageVelocity || jiraStats?.velocity?.averageVelocity || 0;

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
            subtitle={`${combined.githubCount} GitHub, ${combined.gitlabCount} GitLab`}
          />
        )}
        {gitLoading ? (
          <Skeleton variant="stat-card" />
        ) : (
          <StatsCard
            title="Avg PRs/MRs per Month"
            value={combined.avgPRsPerMonth}
            subtitle={getPRComparison(combined.avgPRsPerMonth)}
          />
        )}
        {jiraLoading ? (
          <Skeleton variant="stat-card" />
        ) : combinedVelocity > 0 ? (
          <StatsCard
            title="Average Velocity per Sprint"
            value={combinedVelocity}
            subtitle={formatVelocitySubtitle(combinedVelocity, jiraStats?.velocity?.totalSprints)}
          />
        ) : null}
      </div>
    </div>
  );
}

export default CombinedOverview;

