import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { formatNumber } from '../../utils/analyticsHelpers';
import '../../styles/analytics-common.css';
import './ProjectAnalytics.css';

/**
 * Year-over-Year comparison chart - shows 2024 vs 2025 data aligned by week
 */
function YoYChart({ prevYearData, currYearData, height = 250 }) {
  // Convert data objects to arrays aligned by days since season start
  const prevArray = Object.entries(prevYearData || {})
    .map(([date, data]) => ({ ...data, date, year: 2024 }))
    .sort((a, b) => a.daysSinceStart - b.daysSinceStart);
  
  const currArray = Object.entries(currYearData || {})
    .map(([date, data]) => ({ ...data, date, year: 2025 }))
    .sort((a, b) => a.daysSinceStart - b.daysSinceStart);

  // Find max for scaling
  const allValues = [...prevArray.map(d => d.pageViews), ...currArray.map(d => d.pageViews)];
  const maxValue = Math.max(...allValues, 1);

  // Create week labels (Week 1, Week 2, etc.)
  const maxWeeks = Math.max(
    ...prevArray.map(d => d.weekNum || 0),
    ...currArray.map(d => d.weekNum || 0)
  ) + 1;

  return (
    <div className="yoy-chart" style={{ height }}>
      <div className="yoy-chart-container">
        {/* Y-axis */}
        <div className="yoy-y-axis">
          <span>{formatNumber(maxValue)}</span>
          <span>{formatNumber(maxValue / 2)}</span>
          <span>0</span>
        </div>
        
        {/* Chart area */}
        <div className="yoy-chart-area">
          {/* Previous year line */}
          <svg className="yoy-line-chart" viewBox={`0 0 ${currArray.length * 4} 100`} preserveAspectRatio="none">
            {/* 2024 line */}
            <polyline
              className="line-2024"
              fill="none"
              stroke="#94a3b8"
              strokeWidth="1.5"
              points={prevArray.map((d, i) => 
                `${i * 4},${100 - (d.pageViews / maxValue) * 95}`
              ).join(' ')}
            />
            {/* 2025 line */}
            <polyline
              className="line-2025"
              fill="none"
              stroke="#667eea"
              strokeWidth="2"
              points={currArray.map((d, i) => 
                `${i * 4},${100 - (d.pageViews / maxValue) * 95}`
              ).join(' ')}
            />
          </svg>
          
          {/* Week markers */}
          <div className="yoy-week-markers">
            {Array.from({ length: Math.min(maxWeeks, 20) }, (_, i) => (
              <span key={i} className="week-label">
                {i % 4 === 0 ? `Wk ${i + 1}` : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Project-specific analytics dashboard (e.g., NFL Gamecast redesign)
 * Shows page views, bet clicks, and conversion rate before/after launch
 */
function ProjectAnalytics({ projectKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // eslint-disable-next-line no-unused-vars
  const [activeMetric, setActiveMetric] = useState('pageViews'); // pageViews, betClicks, conversionRate - for future metric toggle
  
  // Check for mock mode from URL
  const mockParam = new URLSearchParams(window.location.search).get('mock') === 'true' ? '?mock=true' : '';

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const response = await axios.get(`/api/analytics/project/${projectKey}${mockParam}`);
        setData(response.data);
        setError(null);
      } catch (err) {
        setError(err.response?.data?.error || err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [projectKey, mockParam]);

  if (loading) {
    return (
      <div className="project-analytics loading">
        <div className="loading-spinner"></div>
        <p>Loading project analytics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="project-analytics error">
        <p>Error: {error}</p>
      </div>
    );
  }

  if (!data) return null;

  const { project, analytics } = data;
  const { totals, breakdown, yearOverYear } = analytics;

  return (
    <div className="project-analytics">
      <div className="section-header">
        <h2 className="section-title">{project.label}</h2>
        <div className="date-info">
          <span className="date-label">Launch:</span>
          <span className="date-value">{project.launchDate}</span>
          {project.myBetsEndDate && (
            <>
              <span className="date-separator">→</span>
              <span className="date-label">My Bets End:</span>
              <span className="date-value">{project.myBetsEndDate}</span>
            </>
          )}
          {!project.myBetsEndDate && project.endDate && (
            <>
              <span className="date-separator">→</span>
              <span className="date-label">End:</span>
              <span className="date-value">{project.endDate}</span>
            </>
          )}
        </div>
      </div>
      
      {project.description && (
        <p className="section-subtitle" style={{ marginBottom: '20px' }}>{project.description}</p>
      )}
      
      {project.notes && (
        <p className="insight-callout yellow" style={{ marginBottom: '20px' }}>ℹ️ {project.notes}</p>
      )}

      {/* Summary Stats */}
      <div className="stats-row" style={{ marginBottom: '24px' }}>
        <div className="stat-card-primary">
          <span className="stat-value">{formatNumber(totals.pageViews)}</span>
          <span className="stat-label">Total Page Views</span>
        </div>
        <div className="stat-card-primary">
          <span className="stat-value">{formatNumber(totals.betClicks)}</span>
          <span className="stat-label">Total Bet Clicks</span>
        </div>
        <div className="stat-card-primary">
          <span className="stat-value">{totals.conversionRate}</span>
          <span className="stat-label">Bet Click Rate</span>
          <span className="stat-hint">% of page views with bet click</span>
        </div>
      </div>

      {/* Year-over-Year Comparison - Main Story */}
      {yearOverYear && (
        <div className="section-card highlight-yellow">
          <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#854d0e', margin: '0 0 4px' }}>📅 2024 vs 2025 NFL Season</h3>
          <p className="section-subtitle" style={{ color: '#a16207', marginBottom: '16px' }}>
            Comparing same period: {yearOverYear.previousYear.dateRange.start.slice(5)} to {yearOverYear.previousYear.dateRange.end.slice(5)}
          </p>
          <div className="stats-row" style={{ marginBottom: '16px' }}>
            <div className="stat-card-secondary" style={{ borderColor: '#fef08a' }}>
              <span className="stat-label" style={{ color: '#713f12' }}>Page Views</span>
              <div className="yoy-values">
                <span className="last-year">{formatNumber(yearOverYear.previousYear.pageViews)}</span>
                <span className="arrow">→</span>
                <span className="this-year">{formatNumber(yearOverYear.currentYear.pageViews)}</span>
              </div>
              <span className={`change-badge ${yearOverYear.change.pageViews >= 0 ? 'positive' : 'negative'}`}>
                {yearOverYear.change.pageViews >= 0 ? '+' : ''}{yearOverYear.change.pageViews}%
              </span>
            </div>
            <div className="stat-card-highlight">
              <span className="stat-label">Visits per User</span>
              <div className="yoy-values" style={{ color: 'white' }}>
                <span className="last-year" style={{ color: 'rgba(255,255,255,0.7)' }}>{yearOverYear.previousYear.visitsPerVisitor}</span>
                <span className="arrow" style={{ color: 'rgba(255,255,255,0.5)' }}>→</span>
                <span className="this-year" style={{ color: 'white', fontSize: '20px' }}>{yearOverYear.currentYear.visitsPerVisitor}</span>
              </div>
              <span className="change-badge-pill">
                {yearOverYear.change.visitsPerVisitor >= 0 ? '+' : ''}{yearOverYear.change.visitsPerVisitor}% 🔥
              </span>
            </div>
          </div>
          <p className="insight-callout yellow">
            🚀 Users returned <strong>{yearOverYear.change.visitsPerVisitor}% more often</strong> this season, 
            suggesting the redesign is driving better engagement.
          </p>
        </div>
      )}

      {/* Linked Users Summary - My Bets Feature Impact */}
      {breakdown && breakdown.values && (
        <div className="section-card highlight-green">
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#166534', margin: '0 0 4px' }}>🎯 Linked Bet Accounts (This Year Only)</h3>
          <p className="section-subtitle" style={{ marginBottom: '16px' }}>Users who linked their betting account with ESPN</p>
          {(() => {
            const linked = breakdown.values.find(v => v.value === 'yes');
            const notLinked = breakdown.values.find(v => v.value === 'no');
            if (!linked) return <p>No linked user data available</p>;
            
            const linkedRate = parseFloat(linked.conversionRate) || 0;
            const notLinkedRate = parseFloat(notLinked?.conversionRate) || 0;
            const conversionMultiplier = notLinkedRate > 0 ? Math.round(linkedRate / notLinkedRate) : 0;
            const returnMultiplier = notLinked?.visitsPerVisitor > 0 
              ? (linked.visitsPerVisitor / notLinked.visitsPerVisitor).toFixed(1) 
              : 0;

            return (
              <div className="stats-row">
                <div className="stat-card-highlight">
                  <span className="stat-value">{formatNumber(linked.visitors)}</span>
                  <span className="stat-label">Linked Users</span>
                </div>
                <div className="stat-card-secondary" style={{ borderColor: '#dcfce7' }}>
                  <span className="stat-value" style={{ color: '#166534' }}>{formatNumber(linked.betClicks)}</span>
                  <span className="stat-label" style={{ color: '#15803d' }}>Bet Clicks</span>
                </div>
                <div className="stat-card-secondary" style={{ borderColor: '#dcfce7' }}>
                  <span className="stat-value" style={{ color: '#166534' }}>{linked.visitsPerVisitor}</span>
                  <span className="stat-label" style={{ color: '#15803d' }}>Visits/User</span>
                  <span className="stat-hint">{returnMultiplier}x vs non-linked</span>
                </div>
                <div className="stat-card-secondary" style={{ borderColor: '#dcfce7' }}>
                  <span className="stat-value" style={{ color: '#166534' }}>{conversionMultiplier}x</span>
                  <span className="stat-label" style={{ color: '#15803d' }}>Bet Click Rate</span>
                  <span className="stat-hint">vs non-linked</span>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Detailed Breakdown Table */}
      {breakdown && breakdown.values && breakdown.values.length > 0 && (
        <div className="section-card highlight-gray">
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#1e293b', margin: '0 0 16px' }}>
            {breakdown.dimension === 'evar122' ? 'Bet Account Linked Breakdown' : breakdown.dimension}
          </h3>
          <div className="data-table">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Visitors</th>
                  <th>Visits</th>
                  <th>Visits/Visitor</th>
                  <th>Page Views</th>
                  <th>Bet Clicks</th>
                  <th>Conv. Rate</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.values
                  .sort((a, b) => b.pageViews - a.pageViews)
                  .map((item) => (
                    <tr key={item.value} className={item.value === 'yes' ? 'highlight' : ''}>
                      <td>
                        {item.value === 'yes' && <span className="status-badge linked">✓ Linked</span>}
                        {item.value === 'no' && <span className="status-badge not-linked">Not Linked</span>}
                        {item.value === 'Unspecified' && <span className="status-badge unspecified">Unknown</span>}
                        {!['yes', 'no', 'Unspecified'].includes(item.value) && item.value}
                      </td>
                      <td>{formatNumber(item.visitors)}</td>
                      <td>{formatNumber(item.visits)}</td>
                      <td style={{ fontWeight: 600, color: '#0891b2' }}>{item.visitsPerVisitor || '—'}</td>
                      <td>{formatNumber(item.pageViews)}</td>
                      <td>{formatNumber(item.betClicks)}</td>
                      <td style={{ fontWeight: 600, color: '#4f46e5' }}>{item.conversionRate}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {breakdown.dimension === 'evar122' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '16px' }}>
              <p className="insight-callout">
                💡 <strong>Conversion:</strong> Linked users have a <strong>
                  {(() => {
                    const linked = breakdown.values.find(v => v.value === 'yes');
                    const notLinked = breakdown.values.find(v => v.value === 'no');
                    if (linked && notLinked) {
                      const linkedRate = parseFloat(linked.conversionRate) || 0;
                      const notLinkedRate = parseFloat(notLinked.conversionRate) || 0;
                      if (notLinkedRate > 0) {
                        return Math.round(linkedRate / notLinkedRate) + 'x';
                      }
                    }
                    return '—';
                  })()}
                </strong> higher bet click rate than non-linked users.
              </p>
              <p className="insight-callout">
                🔄 <strong>Retention:</strong> Linked users average <strong>
                  {(() => {
                    const linked = breakdown.values.find(v => v.value === 'yes');
                    const notLinked = breakdown.values.find(v => v.value === 'no');
                    if (linked && notLinked && linked.visitsPerVisitor && notLinked.visitsPerVisitor) {
                      return `${linked.visitsPerVisitor} visits/user`;
                    }
                    return '—';
                  })()}
                </strong> vs <strong>
                  {(() => {
                    const notLinked = breakdown.values.find(v => v.value === 'no');
                    if (notLinked && notLinked.visitsPerVisitor) {
                      return `${notLinked.visitsPerVisitor} visits/user`;
                    }
                    return '—';
                  })()}
                </strong> for non-linked.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Year-over-Year Chart */}
      {yearOverYear && yearOverYear.previousYear?.dailyData && yearOverYear.currentYear?.dailyData && (
        <div className="section-card">
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#1e293b', margin: '0 0 12px' }}>📈 Daily Page Views: 2024 vs 2025</h3>
          <div className="chart-legend">
            <span className="legend-item">
              <span className="legend-dot prev-year"></span>
              2024 Season
            </span>
            <span className="legend-item">
              <span className="legend-dot curr-year"></span>
              2025 Season
            </span>
          </div>
          <div className="project-chart">
            <YoYChart 
              prevYearData={yearOverYear.previousYear.dailyData}
              currYearData={yearOverYear.currentYear.dailyData}
              height={280}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default ProjectAnalytics;

