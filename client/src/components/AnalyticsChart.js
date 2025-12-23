import React from 'react';
import './AnalyticsChart.css';
import { formatNumber } from '../utils/mockAnalyticsData';

// Simple bar chart component
export function BarChart({ data, dataKey, labelKey, title, color = '#667eea' }) {
  const maxValue = Math.max(...data.map(d => d[dataKey]));
  
  return (
    <div className="chart-container">
      {title && <h4 className="chart-title">{title}</h4>}
      <div className="bar-chart">
        {data.map((item, index) => (
          <div key={index} className="bar-item">
            <span className="bar-label">{item[labelKey]}</span>
            <div className="bar-wrapper">
              <div 
                className="bar-fill"
                style={{ 
                  width: `${(item[dataKey] / maxValue) * 100}%`,
                  backgroundColor: color
                }}
              />
            </div>
            <span className="bar-value">{formatNumber(item[dataKey])}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Simple line/area chart using CSS
export function AreaChart({ data, dataKey, labelKey, title, color = '#667eea' }) {
  const maxValue = Math.max(...data.map(d => d[dataKey]));
  const minValue = Math.min(...data.map(d => d[dataKey]));
  const range = maxValue - minValue;
  
  return (
    <div className="chart-container">
      {title && <h4 className="chart-title">{title}</h4>}
      <div className="area-chart">
        <div className="area-chart-grid">
          {[0, 25, 50, 75, 100].map(tick => (
            <div key={tick} className="grid-line" style={{ bottom: `${tick}%` }}>
              <span className="grid-label">
                {formatNumber(minValue + (range * tick / 100))}
              </span>
            </div>
          ))}
        </div>
        <div className="area-chart-bars">
          {data.map((item, index) => {
            const height = range > 0 ? ((item[dataKey] - minValue) / range) * 100 : 50;
            return (
              <div key={index} className="area-bar-wrapper" title={`${item[labelKey]}: ${formatNumber(item[dataKey])}`}>
                <div 
                  className="area-bar"
                  style={{ 
                    height: `${Math.max(height, 5)}%`,
                    backgroundColor: color
                  }}
                />
              </div>
            );
          })}
        </div>
        <div className="area-chart-labels">
          {data.filter((_, i) => i % Math.ceil(data.length / 7) === 0).map((item, index) => (
            <span key={index} className="area-label">{item[labelKey]}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// Donut/Pie chart using CSS
export function DonutChart({ data, valueKey, labelKey, title }) {
  const total = data.reduce((sum, item) => sum + item[valueKey], 0);
  const colors = ['#667eea', '#764ba2', '#f093fb', '#f5576c', '#4facfe', '#00f2fe'];
  
  let cumulativePercent = 0;
  const segments = data.map((item, index) => {
    const percent = (item[valueKey] / total) * 100;
    const segment = {
      ...item,
      percent,
      color: colors[index % colors.length],
      offset: cumulativePercent,
    };
    cumulativePercent += percent;
    return segment;
  });
  
  // Create conic gradient
  const gradient = segments.map(s => 
    `${s.color} ${s.offset}% ${s.offset + s.percent}%`
  ).join(', ');
  
  return (
    <div className="chart-container">
      {title && <h4 className="chart-title">{title}</h4>}
      <div className="donut-chart-wrapper">
        <div 
          className="donut-chart"
          style={{ background: `conic-gradient(${gradient})` }}
        >
          <div className="donut-hole">
            <span className="donut-total">{formatNumber(total)}</span>
            <span className="donut-label">Total</span>
          </div>
        </div>
        <div className="donut-legend">
          {segments.map((item, index) => (
            <div key={index} className="legend-item">
              <span className="legend-color" style={{ backgroundColor: item.color }} />
              <span className="legend-label">{item[labelKey]}</span>
              <span className="legend-value">{item.percent.toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Stats summary cards
export function StatsSummary({ data }) {
  return (
    <div className="stats-summary">
      <div className="stat-item">
        <span className="stat-value">{formatNumber(data.uniqueVisitors)}</span>
        <span className="stat-label">Unique Visitors</span>
      </div>
      <div className="stat-item">
        <span className="stat-value">{formatNumber(data.totalVisits)}</span>
        <span className="stat-label">Total Visits</span>
      </div>
      <div className="stat-item">
        <span className="stat-value">{formatNumber(data.totalPageViews)}</span>
        <span className="stat-label">Page Views</span>
      </div>
      <div className="stat-item">
        <span className="stat-value">{data.avgSessionDuration}</span>
        <span className="stat-label">Avg Session</span>
      </div>
      <div className="stat-item">
        <span className="stat-value">{data.bounceRate}%</span>
        <span className="stat-label">Bounce Rate</span>
      </div>
      <div className="stat-item">
        <span className="stat-value">{data.pagesPerSession}</span>
        <span className="stat-label">Pages/Session</span>
      </div>
    </div>
  );
}

// Main Analytics Dashboard component
export default function AnalyticsDashboard({ analyticsData }) {
  if (!analyticsData) return null;
  
  return (
    <div className="analytics-dashboard">
      <div className="analytics-header">
        <h2>📊 Analytics Overview</h2>
        {analyticsData.isMockData && (
          <span className="mock-data-badge">Demo Data</span>
        )}
      </div>
      
      <StatsSummary data={analyticsData.summary} />
      
      <div className="analytics-charts">
        <div className="chart-row">
          <AreaChart 
            data={analyticsData.dailyData}
            dataKey="visitors"
            labelKey="dateLabel"
            title="Daily Visitors (Last 30 Days)"
            color="#667eea"
          />
        </div>
        
        <div className="chart-row two-col">
          <BarChart 
            data={analyticsData.topPages.slice(0, 6)}
            dataKey="pageViews"
            labelKey="page"
            title="Top Pages"
            color="#764ba2"
          />
          <DonutChart 
            data={analyticsData.devices}
            valueKey="visits"
            labelKey="device"
            title="Traffic by Device"
          />
        </div>
        
        <div className="chart-row two-col">
          <BarChart 
            data={analyticsData.referrers}
            dataKey="visits"
            labelKey="source"
            title="Traffic Sources"
            color="#f093fb"
          />
          <div className="chart-container">
            <h4 className="chart-title">Top Pages Performance</h4>
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>Page</th>
                  <th>Views</th>
                  <th>Avg Time</th>
                  <th>Bounce</th>
                </tr>
              </thead>
              <tbody>
                {analyticsData.topPages.slice(0, 5).map((page, i) => (
                  <tr key={i}>
                    <td>{page.page}</td>
                    <td>{formatNumber(page.pageViews)}</td>
                    <td>{page.avgTimeOnPage}</td>
                    <td>{page.bounceRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

