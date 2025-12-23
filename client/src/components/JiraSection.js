import React from 'react';
import { useNavigate } from 'react-router-dom';
import StatsCard from './StatsCard';
import MonthlyChart from './MonthlyChart';
import VelocityChart from './VelocityChart';
import ChartCard from './ChartCard';
import BarChartCard from './BarChartCard';
import PRList from './PRList';
import { prepareProjectData } from '../utils/chartHelpers';
import './JiraSection.css';

function JiraSection({ stats, compact = false }) {
  const navigate = useNavigate();
  
  if (!stats || stats.error) return null;

  const projectData = prepareProjectData(stats.byProject);

  return (
    <div className="source-section">
      <h2>📋 Jira</h2>
      <div className="cards-grid">
        <div 
          onClick={() => navigate('/issues')}
          className="stats-card-clickable"
        >
          <StatsCard
            title="Total Issues"
            value={stats.total}
            subtitle={`${stats.done || 0} done, ${stats.inProgress || 0} in progress`}
          />
        </div>
        <StatsCard
          title="Total Story Points"
          value={stats.totalStoryPoints || 0}
          subtitle={`${stats.total || 0} issues`}
        />
        <StatsCard
          title="Avg Resolution Time"
          value={`${stats.avgResolutionTime || 0} days`}
          subtitle={stats.avgResolutionTimeCount !== undefined 
            ? `In Progress → QA Ready (${stats.avgResolutionTimeCount} issues)`
            : "In Progress → QA Ready"}
        />
        {stats.velocity && (
          <StatsCard
            title="Avg Velocity"
            value={stats.velocity.averageVelocity}
            subtitle={`${stats.velocity.totalSprints} sprints`}
          />
        )}
      </div>

      {!compact && (
        <>
          {/* Monthly Issues Chart */}
          {stats.monthlyIssues && stats.monthlyIssues.length > 0 && (
            <MonthlyChart 
              monthlyData={stats.monthlyIssues} 
              title="Issues per Month"
            />
          )}


          {/* Velocity Charts */}
          {stats.velocity && stats.velocity.byBoard ? (
            Object.entries(stats.velocity.byBoard).map(([boardName, boardData]) => {
              if (!boardData.sprints || boardData.sprints.length === 0) return null;
              return (
                <VelocityChart 
                  key={boardName}
                  sprints={boardData.sprints} 
                  title={`${boardName} Velocity Over Time`}
                  showBenchmarks={false}
                  baseUrl={stats.baseUrl}
                />
              );
            })
          ) : stats.velocity && stats.velocity.sprints && stats.velocity.sprints.length > 0 ? (
            <VelocityChart sprints={stats.velocity.sprints} showBenchmarks={false} baseUrl={stats.baseUrl} />
          ) : stats.velocity ? (
            <ChartCard title="Velocity Over Time">
              <div className="no-data-message no-data-message-large">
                No sprint data available. Issues need to be assigned to sprints with start and end dates in Jira.
              </div>
            </ChartCard>
          ) : null}

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
        </>
      )}
    </div>
  );
}

export default JiraSection;

