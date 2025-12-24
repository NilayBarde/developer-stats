import React, { useState } from 'react';
import './ProjectAnalyticsChart.css';

function MiniChart({ dailyData, launchDate, maxValue }) {
  if (!dailyData || dailyData.length === 0) return null;
  
  const max = maxValue || Math.max(...dailyData.map(d => d.pageViews), 1);
  // Compare dates as strings (YYYY-MM-DD format) to avoid timezone issues
  const launchDateIndex = launchDate 
    ? dailyData.findIndex(d => d.date >= launchDate.split('T')[0])
    : -1;

  return (
    <div className="mini-chart">
      <div className="chart-bars">
        {dailyData.map((day, index) => {
          const height = (day.pageViews / max) * 100;
          const isAfterLaunch = launchDateIndex >= 0 && index >= launchDateIndex;
          
          return (
            <div 
              key={day.date} 
              className={`chart-bar ${isAfterLaunch ? 'after-launch' : 'before-launch'}`}
              style={{ height: `${Math.max(height, 2)}%` }}
              title={`${day.date}: ${formatNumber(day.pageViews)} views`}
            />
          );
        })}
      </div>
      {launchDateIndex >= 0 && (
        <div 
          className="launch-marker" 
          style={{ left: `${(launchDateIndex / dailyData.length) * 100}%` }}
        />
      )}
    </div>
  );
}

import { formatNumber } from '../utils/analyticsHelpers';

function ProjectAnalyticsChart({ analytics }) {
  const [expandedPage, setExpandedPage] = useState(null);
  
  if (!analytics || analytics.error) {
    return null;
  }

  const { trackingType, label, launchDate, pages, totalPageViews, totalVisitors, dailyData, comparison } = analytics;

  // Multi-page view
  if (trackingType === 'multi-page' && pages) {
    // Find max across all pages for consistent scaling
    const allMaxes = pages.map(p => Math.max(...(p.dailyData || []).map(d => d.pageViews), 0));
    const globalMax = Math.max(...allMaxes, 1);
    
    return (
      <div className="project-analytics multi-page">
        <div className="analytics-header">
          <span className="analytics-title">📊 {label}</span>
          <div className="analytics-totals">
            <span className="total-stat">{formatNumber(totalPageViews)} views</span>
            <span className="total-stat">{formatNumber(totalVisitors)} visitors</span>
          </div>
        </div>
        
        {launchDate && (
          <div className="launch-info">
            Launch: {new Date(launchDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
        )}
        
        <div className="pages-grid">
          {pages.map((page, index) => (
            <div 
              key={page.filter} 
              className={`page-card ${expandedPage === index ? 'expanded' : ''}`}
              onClick={() => setExpandedPage(expandedPage === index ? null : index)}
            >
              <div className="page-header">
                <span className="page-label">{page.label}</span>
                <span className="page-views">{formatNumber(page.totalPageViews)}</span>
              </div>
              
              <MiniChart 
                dailyData={page.dailyData} 
                launchDate={launchDate}
                maxValue={globalMax}
              />
              
              {page.comparison && page.comparison.changePercent !== null && (
                <div className={`page-change ${page.comparison.changePercent >= 0 ? 'positive' : 'negative'}`}>
                  {page.comparison.changePercent >= 0 ? '↑' : '↓'} {Math.abs(page.comparison.changePercent)}%
                </div>
              )}
              
              {expandedPage === index && (
                <div className="page-details">
                  <div className="detail-row">
                    <span>Visitors:</span>
                    <span>{formatNumber(page.totalVisitors)}</span>
                  </div>
                  <div className="detail-row">
                    <span>Visits:</span>
                    <span>{formatNumber(page.totalVisits)}</span>
                  </div>
                  {page.comparison && (
                    <>
                      <div className="detail-row">
                        <span>Avg before:</span>
                        <span>{formatNumber(page.comparison.avgPageViewsBefore)}/day</span>
                      </div>
                      <div className="detail-row">
                        <span>Avg after:</span>
                        <span>{formatNumber(page.comparison.avgPageViewsAfter)}/day</span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Single-page view (original)
  return (
    <div className="project-analytics single-page">
      <div className="analytics-header">
        <span className="analytics-title">📊 {label}</span>
        {launchDate && (
          <span className="analytics-launch">
            Launch: {new Date(launchDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>
      
      <MiniChart dailyData={dailyData} launchDate={launchDate} />
      
      <div className="analytics-stats">
        <div className="analytics-stat">
          <span className="stat-value">{formatNumber(totalPageViews)}</span>
          <span className="stat-label">Page Views</span>
        </div>
        <div className="analytics-stat">
          <span className="stat-value">{formatNumber(totalVisitors)}</span>
          <span className="stat-label">Visitors</span>
        </div>
        {comparison && comparison.changePercent !== null && (
          <div className="analytics-stat comparison">
            <span className={`stat-value ${comparison.changePercent >= 0 ? 'positive' : 'negative'}`}>
              {comparison.changePercent >= 0 ? '+' : ''}{comparison.changePercent}%
            </span>
            <span className="stat-label">vs. Pre-Launch</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default ProjectAnalyticsChart;
