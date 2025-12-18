import React from 'react';
import StatsCard from './StatsCard';
import MonthlyChart from './MonthlyChart';
import VelocityChart from './VelocityChart';
import ChartCard from './ChartCard';
import BarChartCard from './BarChartCard';
import PRList from './PRList';

/**
 * Prepare issue type data for chart
 */
function prepareIssueTypeData(byType) {
  if (!byType) return [];
  return Object.entries(byType).map(([type, data]) => ({
    type,
    total: data.total,
    resolved: data.resolved
  }));
}

/**
 * Prepare project data for chart
 */
function prepareProjectData(byProject) {
  if (!byProject) return [];
  return Object.entries(byProject).map(([project, data]) => ({
    project,
    total: data.total,
    resolved: data.resolved,
    open: data.open
  }));
}

/**
 * Render velocity charts by board
 */
function renderVelocityCharts(velocity) {
  if (!velocity) return null;
  
  if (velocity.byBoard) {
    return Object.entries(velocity.byBoard).map(([boardName, boardData]) => {
      if (!boardData.sprints || boardData.sprints.length === 0) return null;
      return (
        <VelocityChart 
          key={boardName}
          sprints={boardData.sprints} 
          title={`${boardName} Velocity Over Time`}
          showBenchmarks={false}
        />
      );
    });
  }
  
  if (velocity.sprints && velocity.sprints.length > 0) {
    return <VelocityChart sprints={velocity.sprints} showBenchmarks={false} />;
  }
  
  return (
    <ChartCard title="Velocity Over Time">
      <div className="no-data-message" style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
        No sprint data available. Issues need to be assigned to sprints with start and end dates in Jira.
      </div>
    </ChartCard>
  );
}

function JiraSection({ stats }) {
  if (!stats || stats.error) return null;

  const issueTypeData = prepareIssueTypeData(stats.byType);
  const projectData = prepareProjectData(stats.byProject);

  return (
    <div className="source-section">
      <h2>📋 Jira</h2>
      <div className="cards-grid">
        <StatsCard
          title="Total Issues"
          value={stats.total}
          subtitle={`${stats.last30Days || 0} in last 30 days`}
        />
        <StatsCard
          title="Resolved"
          value={stats.resolved}
          subtitle={`${stats.inProgress || 0} in progress`}
        />
        <StatsCard
          title="Done"
          value={stats.done}
          subtitle={`${stats.inProgress || 0} in progress`}
        />
        <StatsCard
          title="Avg Resolution Time"
          value={`${stats.avgResolutionTime || 0} days`}
          subtitle="Average"
        />
        {stats.avgIssuesPerMonth !== undefined && (
          <StatsCard
            title="Avg Issues per Month"
            value={stats.avgIssuesPerMonth}
            subtitle="Monthly average"
          />
        )}
        {stats.velocity && (
          <StatsCard
            title="Avg Velocity"
            value={stats.velocity.averageVelocity}
            subtitle={`${stats.velocity.totalSprints} sprints`}
          />
        )}
      </div>

      {/* Monthly Issues Chart */}
      {stats.monthlyIssues && stats.monthlyIssues.length > 0 && (
        <MonthlyChart 
          monthlyData={stats.monthlyIssues} 
          title="Issues per Month"
        />
      )}


      {/* Velocity Charts */}
      {renderVelocityCharts(stats.velocity)}

      {/* Issue Types Chart */}
      <BarChartCard
        title="Issues by Type"
        data={issueTypeData}
        xAxisKey="type"
        bars={[
          { dataKey: 'total', fill: '#667eea', name: 'Total' },
          { dataKey: 'resolved', fill: '#48bb78', name: 'Resolved' }
        ]}
      />

      {/* Projects Chart */}
      <BarChartCard
        title="Issues by Project"
        data={projectData}
        xAxisKey="project"
        bars={[
          { dataKey: 'total', fill: '#667eea', name: 'Total' },
          { dataKey: 'resolved', fill: '#48bb78', name: 'Resolved' },
          { dataKey: 'open', fill: '#ed8936', name: 'Open' }
        ]}
      />

      {/* Recent Issues List */}
      {stats.issues && stats.issues.length > 0 && (
        <PRList prs={stats.issues} source="jira" baseUrl={stats.baseUrl} />
      )}
    </div>
  );
}

export default JiraSection;

