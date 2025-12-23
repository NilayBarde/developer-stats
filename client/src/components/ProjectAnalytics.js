import React, { useState, useMemo } from 'react';
import { getMockProjectAnalytics, formatNumber } from '../utils/mockAnalyticsData';
import './ProjectAnalytics.css';

// Mini area chart for project cards
function MiniAreaChart({ data, dataKey, color = '#667eea' }) {
  const maxValue = Math.max(...data.map(d => d[dataKey]));
  const minValue = Math.min(...data.map(d => d[dataKey]));
  const range = maxValue - minValue || 1;
  
  return (
    <div className="mini-area-chart">
      {data.map((item, index) => {
        const height = ((item[dataKey] - minValue) / range) * 100;
        return (
          <div 
            key={index} 
            className="mini-bar"
            style={{ 
              height: `${Math.max(height, 8)}%`,
              backgroundColor: color,
              opacity: 0.6 + (height / 250)
            }}
            title={`${item.dateLabel}: ${formatNumber(item[dataKey])}`}
          />
        );
      })}
    </div>
  );
}

// Mini stat display
function MiniStat({ label, value, trend }) {
  return (
    <div className="mini-stat">
      <span className="mini-stat-value">{value}</span>
      <span className="mini-stat-label">{label}</span>
      {trend && (
        <span className={`mini-stat-trend ${trend > 0 ? 'up' : 'down'}`}>
          {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}%
        </span>
      )}
    </div>
  );
}

export default function ProjectAnalytics({ projectName, epicKey }) {
  const [expanded, setExpanded] = useState(false);
  
  // Generate consistent mock data for this project
  const analytics = useMemo(() => {
    return getMockProjectAnalytics(projectName, epicKey);
  }, [projectName, epicKey]);
  
  if (!analytics) return null;
  
  return (
    <div className="project-analytics">
      <div 
        className="project-analytics-header"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="analytics-header-left">
          <span className="analytics-icon">📊</span>
          <span className="analytics-title">Analytics</span>
          {analytics.isMockData && (
            <span className="demo-badge">Demo</span>
          )}
        </div>
        <div className="analytics-header-right">
          <div className="quick-stats">
            <span className="quick-stat">
              <strong>{formatNumber(analytics.summary.totalPageViews)}</strong> views
            </span>
            <span className="quick-stat">
              <strong>{formatNumber(analytics.summary.uniqueVisitors)}</strong> visitors
            </span>
          </div>
          <span className={`expand-icon ${expanded ? 'expanded' : ''}`}>▼</span>
        </div>
      </div>
      
      {expanded && (
        <div className="project-analytics-content">
          {/* Stats Row */}
          <div className="analytics-stats-row">
            <MiniStat 
              label="Page Views" 
              value={formatNumber(analytics.summary.totalPageViews)}
              trend={Math.round(-5 + Math.random() * 20)}
            />
            <MiniStat 
              label="Visitors" 
              value={formatNumber(analytics.summary.uniqueVisitors)}
              trend={Math.round(-3 + Math.random() * 15)}
            />
            <MiniStat 
              label="Avg Session" 
              value={analytics.summary.avgSessionDuration}
            />
            <MiniStat 
              label="Bounce Rate" 
              value={`${analytics.summary.bounceRate}%`}
            />
          </div>
          
          {/* Chart */}
          <div className="analytics-chart-section">
            <div className="chart-header">
              <span>Daily Visitors (Last 2 Weeks)</span>
            </div>
            <MiniAreaChart 
              data={analytics.dailyData} 
              dataKey="visitors"
              color="#667eea"
            />
          </div>
          
          {/* Top Pages Table */}
          <div className="analytics-pages-section">
            <div className="chart-header">
              <span>Top Pages</span>
            </div>
            <div className="mini-pages-list">
              {analytics.topPages.slice(0, 4).map((page, i) => (
                <div key={i} className="mini-page-item">
                  <span className="page-name">{page.page}</span>
                  <span className="page-views">{formatNumber(page.pageViews)}</span>
                  <span className="page-bounce">{page.bounceRate}% bounce</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

