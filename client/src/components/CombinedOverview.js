import React from 'react';
import StatsCard from './StatsCard';
import { calculateCombinedStats, getPRComparison } from '../utils/combinedStats';
import { formatVelocitySubtitle } from '../utils/velocityHelpers';

function CombinedOverview({ githubStats, gitlabStats, jiraStats }) {
  // Don't show if all sources have errors
  if (githubStats?.error && gitlabStats?.error && jiraStats?.error) {
    return null;
  }

  const combined = calculateCombinedStats(githubStats, gitlabStats);
  const combinedVelocity = jiraStats?.velocity?.combinedAverageVelocity || jiraStats?.velocity?.averageVelocity || 0;

  return (
    <div className="source-section combined">
      <h2>📊 Combined Overview</h2>
      <div className="cards-grid">
        <StatsCard
          title="Total PRs/MRs"
          value={combined.totalPRs}
          subtitle={`${githubStats?.total || 0} GitHub, ${gitlabStats?.total || 0} GitLab`}
        />
        <StatsCard
          title="Avg PRs/MRs per Month"
          value={combined.avgPRsPerMonth}
          subtitle={getPRComparison(combined.avgPRsPerMonth)}
        />
        {combinedVelocity > 0 && (
          <StatsCard
            title="Average Velocity per Sprint"
            value={combinedVelocity}
            subtitle={formatVelocitySubtitle(combinedVelocity, jiraStats?.velocity?.totalSprints)}
          />
        )}
      </div>
    </div>
  );
}

export default CombinedOverview;

