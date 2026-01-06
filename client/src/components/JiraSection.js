import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import StatsCard from './StatsCard';
import PriorityTable from './PriorityTable';
import MonthlyChart from './MonthlyChart';
import VelocityChart from './VelocityChart';
import ChartCard from './ChartCard';
import PRList from './PRList';
import Skeleton from './ui/Skeleton';
import './JiraSection.css';

/**
 * Component to show tickets not tracked by engineering-metrics
 */
function UntrackedTickets({ velocity }) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  if (!velocity?.monthlyVelocity) return null;
  
  // Collect all untracked tickets across months
  const allUntracked = velocity.monthlyVelocity.flatMap(m => m.untracked || []);
  
  if (allUntracked.length === 0) return null;
  
  const totalPoints = allUntracked.reduce((sum, t) => sum + (t.points || 0), 0);
  
  return (
    <div className="untracked-tickets-card">
      <div 
        className="untracked-header" 
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="untracked-icon">⚠️</span>
        <span className="untracked-title">
          {allUntracked.length} ticket{allUntracked.length !== 1 ? 's' : ''} not tracked by engineering-metrics
        </span>
        <span className="untracked-points">({totalPoints} pts)</span>
        <span className="untracked-toggle">{isExpanded ? '▼' : '▶'}</span>
      </div>
      
      {isExpanded && (
        <div className="untracked-list">
          <p className="untracked-hint">
            These tickets won't appear in your manager's report. Click to fix:
          </p>
          {allUntracked.map(ticket => (
            <a 
              key={ticket.key}
              href={ticket.url}
              target="_blank"
              rel="noopener noreferrer"
              className="untracked-ticket"
            >
              <span className="ticket-key">{ticket.key}</span>
              <span className="ticket-points">{ticket.points} pts</span>
              <span className="ticket-reason">{ticket.reason}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Monthly velocity chart (engineering-metrics style)
 * Shows monthly story points with "approx points per sprint" (monthly / 2)
 */
function MonthlyVelocityChart({ velocity, baseUrl, benchmarks = null }) {
  if (!velocity) return null;
  
  // Use monthlyVelocity or sprints (backward compatible)
  const monthlyData = velocity.monthlyVelocity || velocity.sprints || [];
  
  if (monthlyData.length === 0) {
    return (
      <ChartCard title="Monthly Velocity">
        <div className="no-data-message no-data-message-large">
          No resolved issues found in the selected date range.
        </div>
      </ChartCard>
    );
  }

  return (
    <VelocityChart 
      sprints={monthlyData}
      title="Monthly Velocity (Points / 2 = Approx Per Sprint)"
      showBenchmarks={false} 
      baseUrl={baseUrl}
      isMonthly={true}
      benchmarks={benchmarks}
    />
  );
}

function JiraSection({ stats, ctoiStats, compact = false, loading = false, ctoiLoading = false, benchmarks = null }) {
  const navigate = useNavigate();
  
  if (loading && !stats) {
    return (
      <div className="source-section">
        <h2>Jira</h2>
        <div className="cards-grid">
          <Skeleton variant="stat-card" count={4} />
        </div>
        <div className="priority-tables-row">
          <PriorityTable
            title="Cycle Time by Priority"
            columns={[
              { key: 'priority', label: 'Priority', align: 'left' },
              { key: 'days', label: 'Avg Days', align: 'center' },
              { key: 'issues', label: 'Issues', align: 'center' }
            ]}
            rows={[]}
            summary={{ label: 'Overall' }}
            loading={true}
          />
          <PriorityTable
            title="CTOI Participation"
            columns={[
              { key: 'priority', label: 'Priority', align: 'left' },
              { key: 'fixed', label: 'Fixed', align: 'center' },
              { key: 'participated', label: 'Participated', align: 'center' }
            ]}
            rows={[]}
            summary={{ label: 'Total' }}
            loading={true}
          />
        </div>
      </div>
    );
  }

  if (!stats || stats.error) return null;

  // Cycle time from engineering-metrics format (created → resolved)
  const cycleTime = stats.cycleTime || {};
  
  // Check if cycle time data is available (has counts or any priority values)
  const hasCycleTimeData = cycleTime.counts && (cycleTime.P1 || cycleTime.P2 || cycleTime.P3 || cycleTime.P4);
  
  // CTOI stats can come from props or from stats.ctoi (since we merged it)
  const effectiveCtoiStats = ctoiStats || stats.ctoi;
  const hasCtoiData = effectiveCtoiStats && (effectiveCtoiStats.fixed > 0 || effectiveCtoiStats.participated > 0);

  return (
    <div className="source-section">
      <h2>Jira</h2>
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
          title="Cycle Time (Avg)"
          value={`${cycleTime.overall || stats.avgResolutionTime || 0} days`}
          subtitle={`Created → Resolved (${cycleTime.counts?.total || stats.avgResolutionTimeCount || 0} issues)`}
        />
        {stats.velocity && (
          <StatsCard
            title="Avg Velocity / Sprint"
            value={stats.velocity.averageVelocity}
            subtitle={`${stats.velocity.totalPoints || 0} pts across ${stats.velocity.totalMonths || 0} months`}
          />
        )}
      </div>
      
      {/* Compact tables for priority breakdowns */}
      <div className="priority-tables-row">
        {/* Cycle Time by Priority - compact table */}
        {loading ? (
          <PriorityTable
            title="Cycle Time by Priority"
            columns={[
              { key: 'priority', label: 'Priority', align: 'left' },
              { key: 'days', label: 'Avg Days', align: 'center' },
              { key: 'issues', label: 'Issues', align: 'center' }
            ]}
            rows={[]}
            loading={true}
          />
        ) : hasCycleTimeData ? (
          <PriorityTable
            title="Cycle Time by Priority"
            columns={[
              { key: 'priority', label: 'Priority', align: 'left' },
              { key: 'days', label: 'Avg Days', align: 'center' },
              { key: 'issues', label: 'Issues', align: 'center' }
            ]}
            rows={[
              { priority: 'P1', days: cycleTime.P1, issues: cycleTime.counts.P1 || 0 },
              { priority: 'P2', days: cycleTime.P2, issues: cycleTime.counts.P2 || 0 },
              { priority: 'P3', days: cycleTime.P3, issues: cycleTime.counts.P3 || 0 },
              { priority: 'P4', days: cycleTime.P4, issues: cycleTime.counts.P4 || 0 }
            ].filter(row => row.issues > 0)}
            summary={{
              label: 'Overall',
              days: cycleTime.overall,
              issues: cycleTime.counts.total || 0
            }}
          />
        ) : null}
        
        {/* CTOI Participation - compact table */}
        {(loading || ctoiLoading) ? (
          <PriorityTable
            title="CTOI Participation"
            columns={[
              { key: 'priority', label: 'Priority', align: 'left' },
              { key: 'fixed', label: 'Fixed', align: 'center' },
              { key: 'participated', label: 'Participated', align: 'center' }
            ]}
            rows={[]}
            loading={true}
          />
        ) : hasCtoiData ? (
          <PriorityTable
            title="CTOI Participation"
            columns={[
              { key: 'priority', label: 'Priority', align: 'left' },
              { key: 'fixed', label: 'Fixed', align: 'center' },
              { key: 'participated', label: 'Participated', align: 'center' }
            ]}
            rows={[
              { priority: 'P1', fixed: effectiveCtoiStats.byPriority?.P1?.fixed || 0, participated: effectiveCtoiStats.byPriority?.P1?.participated || 0 },
              { priority: 'P2', fixed: effectiveCtoiStats.byPriority?.P2?.fixed || 0, participated: effectiveCtoiStats.byPriority?.P2?.participated || 0 },
              { priority: 'P3', fixed: effectiveCtoiStats.byPriority?.P3?.fixed || 0, participated: effectiveCtoiStats.byPriority?.P3?.participated || 0 },
              { priority: 'P4', fixed: effectiveCtoiStats.byPriority?.P4?.fixed || 0, participated: effectiveCtoiStats.byPriority?.P4?.participated || 0 }
            ].filter(row => row.fixed > 0 || row.participated > 0)}
            summary={{
              label: 'Total',
              fixed: effectiveCtoiStats.fixed,
              participated: effectiveCtoiStats.participated
            }}
          />
        ) : null}
      </div>

      {/* Untracked tickets warning - always show this */}
      <UntrackedTickets velocity={stats.velocity} />

      {!compact && (
        <>
          {/* Monthly Issues Chart */}
          {stats.monthlyIssues && stats.monthlyIssues.length > 0 && (
            <MonthlyChart 
              monthlyData={stats.monthlyIssues} 
              title="Issues per Month"
            />
          )}

          {/* Monthly Velocity Chart (engineering-metrics style) */}
          <MonthlyVelocityChart 
            velocity={stats.velocity} 
            baseUrl={stats.baseUrl}
            benchmarks={benchmarks}
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

