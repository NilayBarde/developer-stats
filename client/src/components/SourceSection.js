import React from 'react';
import StatsCard from './StatsCard';
import MonthlyChart from './MonthlyChart';
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
  monthlyMRsField = 'monthlyMRs',
  monthlyCommentsField = 'monthlyComments',
  avgPerMonthField = 'avgPRsPerMonth',
  avgMRsPerMonthField = 'avgMRsPerMonth'
}) {
  if (!stats || stats.error) return null;
  
  const label = source === 'github' ? prLabel : mrLabel;
  const items = stats[source === 'github' ? prsField : mrsField];
  const monthlyItems = stats[monthlyPRsField];
  const avgPerMonth = stats[avgPerMonthField];
  
  return (
    <div className="source-section">
      <h2>
        {icon} {source === 'github' ? 'GitHub' : 'GitLab'} 
        {stats.isMock && <span className="mock-badge">(Mock Data)</span>}
      </h2>
      {stats.error && (
        <div className="warning-banner">
          ⚠️ Using mock data due to error: {stats.error}
        </div>
      )}
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
        <StatsCard
          title="Avg Time to Merge"
          value={`${stats.avgTimeToMerge} days`}
          subtitle="Average"
        />
        {avgPerMonth !== undefined && (
          <StatsCard
            title={`Avg ${label} per Month`}
            value={avgPerMonth}
            subtitle="Monthly average"
          />
        )}
        {stats.totalComments !== undefined && (
          <StatsCard
            title="Total Comments"
            value={stats.totalComments}
            subtitle={`Avg: ${stats.avgCommentsPerMonth || 0}/month`}
          />
        )}
      </div>
      {monthlyItems && monthlyItems.length > 0 && (
        <MonthlyChart 
          monthlyData={monthlyItems} 
          title={`${label} per Month`}
        />
      )}
      {(!monthlyItems || monthlyItems.length === 0) && (
        <div className="no-data-message">No {label.toLowerCase()} data available for the selected date range</div>
      )}
      {stats[monthlyCommentsField] && stats[monthlyCommentsField].length > 0 && (
        <MonthlyChart 
          monthlyData={stats[monthlyCommentsField]} 
          title={`${label} Comments per Month`}
        />
      )}
      {(!stats[monthlyCommentsField] || stats[monthlyCommentsField].length === 0) && (
        <div className="no-data-message">No comment data available for the selected date range</div>
      )}
      {items && items.length > 0 && (
        <PRList prs={items} source={source} />
      )}
    </div>
  );
}

export default SourceSection;

