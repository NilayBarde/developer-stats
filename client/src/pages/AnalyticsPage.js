import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import clientCache from '../utils/clientCache';
import './AnalyticsPage.css';

function formatNumber(num) {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num?.toString() || '0';
}

function ClicksChart({ dailyClicks, launchDate, height = 180 }) {
  const [hoveredBar, setHoveredBar] = useState(null);
  
  if (!dailyClicks || Object.keys(dailyClicks).length === 0) {
    return <div className="chart-empty">No click data available</div>;
  }
  
  // Convert dailyClicks map to sorted array
  const clicksArray = Object.entries(dailyClicks)
    .map(([date, data]) => ({ date, clicks: data.clicks || 0 }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  
  const maxClicks = Math.max(...clicksArray.map(d => d.clicks), 1);
  
  // Find launch date index
  const launchDateObj = launchDate ? new Date(launchDate + 'T12:00:00') : null;
  const launchDateIndex = launchDateObj 
    ? clicksArray.findIndex(d => new Date(d.date) >= launchDateObj)
    : -1;

  const labelInterval = Math.max(1, Math.floor(clicksArray.length / 8));
  
  const formatShortDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="trend-chart" style={{ height }}>
      <div className="chart-y-axis">
        <span className="y-label">{formatNumber(maxClicks)}</span>
        <span className="y-label">{formatNumber(Math.round(maxClicks / 2))}</span>
        <span className="y-label">0</span>
      </div>
      
      <div className="chart-main">
        <div className="chart-bars">
          {clicksArray.map((day, index) => {
            const barHeight = (day.clicks / maxClicks) * 100;
            const isAfterLaunch = launchDateIndex >= 0 && index >= launchDateIndex;
            const isLaunchDay = index === launchDateIndex;
            const isHovered = hoveredBar === index;
            
            return (
              <div 
                key={day.date}
                className="chart-bar-container"
                onMouseEnter={() => setHoveredBar(index)}
                onMouseLeave={() => setHoveredBar(null)}
              >
                <div 
                  className={`chart-bar ${isAfterLaunch ? 'after-launch' : 'before-launch'} ${isLaunchDay ? 'launch-day' : ''} ${isHovered ? 'hovered' : ''}`}
                  style={{ height: `${Math.max(barHeight, 2)}%` }}
                />
                {isHovered && (
                  <div className="chart-tooltip">
                    <div className="tooltip-date">{formatShortDate(day.date)}</div>
                    <div className="tooltip-row clicks">
                      <span className="tooltip-label">Bet Clicks:</span>
                      <span className="tooltip-value">{day.clicks.toLocaleString()}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        
        <div className="chart-x-axis">
          {clicksArray.map((day, index) => {
            // Skip last label if it's too close to previous label
            const isLastLabel = index === clicksArray.length - 1;
            const prevLabelIndex = Math.floor((clicksArray.length - 1) / labelInterval) * labelInterval;
            const tooCloseToEnd = isLastLabel && (clicksArray.length - 1 - prevLabelIndex) < labelInterval * 0.6;
            
            if (tooCloseToEnd) return null;
            if (index % labelInterval !== 0 && !isLastLabel) return null;
            
            return (
              <span 
                key={day.date} 
                className="x-label"
                style={{ left: `${(index / (clicksArray.length - 1)) * 100}%` }}
              >
                {formatShortDate(day.date)}
              </span>
            );
          })}
        </div>
        
        {launchDateIndex >= 0 && (
          <div 
            className="launch-marker" 
            style={{ left: `${(launchDateIndex / (clicksArray.length - 1)) * 100}%` }}
          >
            <span className="launch-label">Launch</span>
          </div>
        )}
      </div>
      
      <div className="chart-legend">
        <span className="legend-item before">Before Launch</span>
        <span className="legend-item after">After Launch</span>
      </div>
    </div>
  );
}

function TrendChart({ dailyData, launchDate, dailyClicks, height = 180 }) {
  const [hoveredBar, setHoveredBar] = useState(null);
  
  if (!dailyData || dailyData.length === 0) {
    return <div className="chart-empty">No data available</div>;
  }
  
  // Sort data chronologically (oldest to newest)
  const sortedData = [...dailyData].sort((a, b) => {
    const dateA = new Date(a.date);
    const dateB = new Date(b.date);
    return dateA - dateB;
  });
  
  // Merge click data into sorted data
  const dataWithClicks = sortedData.map(d => ({
    ...d,
    clicks: dailyClicks?.[d.date]?.clicks || 0
  }));
  
  const maxPageViews = Math.max(...dataWithClicks.map(d => d.pageViews), 1);
  
  // Find launch date index in sorted data
  const launchDateObj = launchDate ? new Date(launchDate + 'T12:00:00') : null;
  const launchDateIndex = launchDateObj 
    ? dataWithClicks.findIndex(d => new Date(d.date) >= launchDateObj)
    : -1;

  // Get labels for x-axis (every ~10 bars)
  const labelInterval = Math.max(1, Math.floor(dataWithClicks.length / 8));
  
  // Format short date
  const formatShortDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="trend-chart" style={{ height }}>
      {/* Y-axis labels */}
      <div className="chart-y-axis">
        <span className="y-label">{formatNumber(maxPageViews)}</span>
        <span className="y-label">{formatNumber(Math.round(maxPageViews / 2))}</span>
        <span className="y-label">0</span>
      </div>
      
      <div className="chart-main">
        <div className="chart-bars">
          {dataWithClicks.map((day, index) => {
            const barHeight = (day.pageViews / maxPageViews) * 100;
            const isAfterLaunch = launchDateIndex >= 0 && index >= launchDateIndex;
            const isLaunchDay = index === launchDateIndex;
            const isHovered = hoveredBar === index;
            
            return (
              <div 
                key={day.date}
                className={`chart-bar-container`}
                onMouseEnter={() => setHoveredBar(index)}
                onMouseLeave={() => setHoveredBar(null)}
              >
                <div 
                  className={`chart-bar ${isAfterLaunch ? 'after-launch' : 'before-launch'} ${isLaunchDay ? 'launch-day' : ''} ${isHovered ? 'hovered' : ''}`}
                  style={{ height: `${Math.max(barHeight, 2)}%` }}
                />
                {isHovered && (
                  <div className="chart-tooltip">
                    <div className="tooltip-date">{formatShortDate(day.date)}</div>
                    <div className="tooltip-row">
                      <span className="tooltip-label">Page Views:</span>
                      <span className="tooltip-value">{day.pageViews.toLocaleString()}</span>
                    </div>
                    <div className="tooltip-row">
                      <span className="tooltip-label">Visits:</span>
                      <span className="tooltip-value">{day.visits.toLocaleString()}</span>
                    </div>
                    <div className="tooltip-row">
                      <span className="tooltip-label">Visitors:</span>
                      <span className="tooltip-value">{day.visitors.toLocaleString()}</span>
                    </div>
                    {day.clicks > 0 && (
                      <div className="tooltip-row clicks">
                        <span className="tooltip-label">Bet Clicks:</span>
                        <span className="tooltip-value">{day.clicks.toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        
        {/* X-axis labels */}
        <div className="chart-x-axis">
          {dataWithClicks.map((day, index) => {
            // Skip last label if it's too close to previous label
            const isLastLabel = index === dataWithClicks.length - 1;
            const prevLabelIndex = Math.floor((dataWithClicks.length - 1) / labelInterval) * labelInterval;
            const tooCloseToEnd = isLastLabel && (dataWithClicks.length - 1 - prevLabelIndex) < labelInterval * 0.6;
            
            if (tooCloseToEnd) return null;
            if (index % labelInterval !== 0 && !isLastLabel) return null;
            
            return (
              <span 
                key={day.date} 
                className="x-label"
                style={{ left: `${(index / (dataWithClicks.length - 1)) * 100}%` }}
              >
                {formatShortDate(day.date)}
              </span>
            );
          })}
        </div>
        
        {launchDateIndex >= 0 && (
          <div 
            className="launch-marker" 
            style={{ left: `${(launchDateIndex / dataWithClicks.length) * 100}%` }}
          >
            <span className="launch-label">Launch</span>
          </div>
        )}
      </div>
      
      <div className="chart-legend">
        <span className="legend-item before">Before Launch</span>
        <span className="legend-item after">After Launch</span>
      </div>
    </div>
  );
}

function AnalyticsPage() {
  const [analyticsData, setAnalyticsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchAnalytics = useCallback(async () => {
    const cacheKey = '/api/project-analytics';
    const cached = clientCache.get(cacheKey, null);
    if (cached) {
      setAnalyticsData(cached);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const response = await axios.get('/api/project-analytics');
      setAnalyticsData(response.data);
      clientCache.set(cacheKey, null, response.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to fetch analytics');
      console.error('Error fetching analytics:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  return (
    <div className="analytics-page">
      <header className="page-header">
        <div>
          <h1>Analytics</h1>
          <p className="date-label">Last 90 days · Adobe Analytics</p>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="loading-section">
          <div className="loading-spinner"></div>
          <p>Loading analytics...</p>
        </div>
      ) : !analyticsData || analyticsData.projects?.length === 0 ? (
        <div className="no-data-message">
          <p>No analytics configured</p>
          <p className="hint">Add project analytics in <code>server/config/projectAnalytics.json</code></p>
        </div>
      ) : (
        <div className="analytics-list">
          {[...analyticsData.projects]
            .sort((a, b) => (b.clicks?.totalClicks || 0) - (a.clicks?.totalClicks || 0))
            .map((project) => (
            <div key={project.epicKey} className="analytics-card">
              <div className="analytics-header">
                <div>
                  <h2>{project.label}</h2>
                  <span className="epic-key">{project.epicKey}</span>
                </div>
                {project.launchDate && (
                  <div className="launch-date">
                    Launch: {new Date(project.launchDate + 'T12:00:00').toLocaleDateString('en-US', { 
                      month: 'short', day: 'numeric', year: 'numeric' 
                    })}
                  </div>
                )}
              </div>

              {project.error ? (
                <div className="analytics-error">{project.error}</div>
              ) : (
                <>
                  {/* Stats Cards - only show page views if we have them */}
                  {project.totalPageViews > 0 && (
                    <div className="stats-row">
                      <div className="stat-card">
                        <span className="stat-value">{formatNumber(project.totalPageViews)}</span>
                        <span className="stat-label">Page Views</span>
                      </div>
                      <div className="stat-card">
                        <span className="stat-value">{formatNumber(project.totalVisitors)}</span>
                        <span className="stat-label">Unique Visitors</span>
                      </div>
                      {project.comparison && project.comparison.changePercent !== null && (
                        <div className={`stat-card highlight ${project.comparison.changePercent >= 0 ? 'positive' : 'negative'}`}>
                          <span className="stat-value">
                            {project.comparison.changePercent >= 0 ? '+' : ''}{project.comparison.changePercent}%
                          </span>
                          <span className="stat-label">Page Views Change</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Main stat: Bet clicks change */}
                  {project.clicks?.comparison && project.clicks.comparison.changePercent !== null && (
                    <div className="stats-row">
                      <div className={`stat-card highlight large ${project.clicks.comparison.changePercent >= 0 ? 'positive' : 'negative'}`}>
                        <span className="stat-value">
                          {project.clicks.comparison.changePercent >= 0 ? '+' : ''}{project.clicks.comparison.changePercent}%
                        </span>
                        <span className="stat-label">Bet Clicks Change</span>
                      </div>
                    </div>
                  )}

                  {/* Trend Chart - show clicks chart if we have click data, otherwise page views */}
                  {project.clicks?.dailyClicks && Object.keys(project.clicks.dailyClicks).length > 0 ? (
                    <div className="chart-section">
                      <h3>Daily Bet Clicks</h3>
                      <ClicksChart 
                        dailyClicks={project.clicks.dailyClicks}
                        launchDate={project.launchDate}
                        height={150}
                      />
                    </div>
                  ) : project.dailyData && project.dailyData.length > 0 ? (
                    <div className="chart-section">
                      <h3>Daily Page Views</h3>
                      <TrendChart 
                        dailyData={project.dailyData} 
                        launchDate={project.launchDate}
                        dailyClicks={project.clicks?.dailyClicks}
                        height={150}
                      />
                    </div>
                  ) : null}

                  {/* Before/After Comparison - Page Views */}
                  {project.comparison && (
                    <div className="comparison-section">
                      <h3>Page Views: Before vs After Launch</h3>
                      <div className="comparison-cards">
                        <div className="comparison-card before">
                          <span className="comparison-label">Before ({project.comparison.daysBefore} days)</span>
                          <span className="comparison-value">{formatNumber(project.comparison.avgPageViewsBefore)}</span>
                          <span className="comparison-unit">avg daily views</span>
                        </div>
                        <div className="comparison-arrow">→</div>
                        <div className="comparison-card after">
                          <span className="comparison-label">After ({project.comparison.daysAfter} days)</span>
                          <span className="comparison-value">{formatNumber(project.comparison.avgPageViewsAfter)}</span>
                          <span className="comparison-unit">avg daily views</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Bet Clicks Summary */}
                  {project.clicks && (
                    <div className="comparison-section">
                      <h3>Bet Clicks from Odds Page</h3>
                      
                      {/* Click totals breakdown */}
                      <div className="stats-row clicks-breakdown">
                        <div className="stat-card">
                          <span className="stat-value">{formatNumber(project.clicks.totalClicks)}</span>
                          <span className="stat-label">Total Clicks</span>
                        </div>
                        {project.clicks.espnBetClicks !== undefined && (
                          <div className="stat-card subtle">
                            <span className="stat-value">{formatNumber(project.clicks.espnBetClicks)}</span>
                            <span className="stat-label">ESPN Bet Tracking</span>
                          </div>
                        )}
                        {project.clicks.draftKingsClicks !== undefined && (
                          <div className="stat-card subtle">
                            <span className="stat-value">{formatNumber(project.clicks.draftKingsClicks)}</span>
                            <span className="stat-label">DraftKings Tracking</span>
                          </div>
                        )}
                      </div>

                      {/* Before/After comparison */}
                      {project.clicks.comparison && (
                        <div className="comparison-cards">
                          <div className="comparison-card before">
                            <span className="comparison-label">Before Launch</span>
                            <span className="comparison-value">{formatNumber(project.clicks.comparison.avgClicksBefore)}</span>
                            <span className="comparison-unit">avg daily clicks</span>
                            <span className="comparison-days">{project.clicks.comparison.daysBefore} days</span>
                          </div>
                          <div className="comparison-arrow">→</div>
                          <div className="comparison-card after">
                            <span className="comparison-label">After Launch</span>
                            <span className="comparison-value">{formatNumber(project.clicks.comparison.avgClicksAfter)}</span>
                            <span className="comparison-unit">avg daily clicks</span>
                            <span className="comparison-days">{project.clicks.comparison.daysAfter} days</span>
                          </div>
                        </div>
                      )}
                      
                      <p className="tracking-note">
                        * Includes both ESPN Bet (old) and DraftKings (new) tracking events
                      </p>
                    </div>
                  )}

                  {/* Filter Info */}
                  <div className="filter-info-small">
                    {project.clicks?.clickEventFilter && (
                      <>Tracking clicks containing: <code>{project.clicks.clickEventFilter}</code></>
                    )}
                    {project.pageFilter && !project.clicks?.clickEventFilter && (
                      <>Tracking page: <code>{project.pageFilter}</code></>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default AnalyticsPage;

