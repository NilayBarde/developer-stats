import React from 'react';
import StatsCard from './StatsCard';
import ChartWithFallback from './ChartWithFallback';
import PRList from './PRList';

function SourceSection({ 
  stats, 
  source, 
  icon, 
  prLabel = 'PRs',
  mrLabel = 'MRs',
  prsField = 'prs',
  mrsField = 'mrs',
  monthlyPRsField = 'monthlyPRs',
  avgPerMonthField = 'avgPRsPerMonth'
}) {
  if (!stats || stats.error) return null;
  
  const label = source === 'github' ? prLabel : mrLabel;
  const items = stats[source === 'github' ? prsField : mrsField];
  const monthlyItems = stats[monthlyPRsField];
  const avgPerMonth = stats[avgPerMonthField];
  
  return (
    <div className="source-section">
      <h2>{icon} {source === 'github' ? 'GitHub' : 'GitLab'}</h2>
      <div className="cards-grid">
        <StatsCard
          title={`Total ${label}`}
          value={stats.total}
          subtitle={`${stats.last30Days} in last 30 days`}
        />
        <StatsCard
          title="Merged"
          value={stats.merged}
          subtitle={`${stats.open} open`}
        />
        {avgPerMonth !== undefined && (
          <StatsCard
            title={`Avg ${label} per Month`}
            value={avgPerMonth}
            subtitle="Monthly average"
          />
        )}
      </div>
      <ChartWithFallback
        data={monthlyItems}
        title={`${label} per Month`}
        emptyMessage={`No ${label.toLowerCase()} data available for the selected date range`}
      />
      {items && items.length > 0 && (
        <PRList prs={items} source={source} />
      )}
    </div>
  );
}

export default SourceSection;

