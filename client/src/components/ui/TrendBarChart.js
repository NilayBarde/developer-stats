import React, { useState } from 'react';
import { formatNumber, formatShortDate, parseDate, getLabelInterval } from '../../utils/analyticsHelpers';
import './TrendBarChart.css';

/**
 * A reusable trend bar chart component that shows data over time
 * with optional launch date marker and before/after coloring.
 */
function TrendBarChart({
  data,
  valueKey = 'value',
  dateKey = 'date',
  launchDate = null,
  height = 180,
  showLegend = true,
  showYAxis = true,
  showXAxis = true,
  tooltipLabel = 'Value',
  beforeColor = 'var(--chart-before-color, #94a3b8)',
  afterColor = 'var(--chart-after-color, #667eea)'
}) {
  const [hoveredBar, setHoveredBar] = useState(null);

  if (!data || data.length === 0) {
    return <div className="chart-empty">No data available</div>;
  }

  // Sort data chronologically
  const sortedData = [...data].sort((a, b) => new Date(a[dateKey]) - new Date(b[dateKey]));
  
  const maxValue = Math.max(...sortedData.map(d => d[valueKey] || 0), 1);
  
  // Find launch date index
  const launchDateObj = launchDate ? parseDate(launchDate) : null;
  const launchDateIndex = launchDateObj
    ? sortedData.findIndex(d => parseDate(d[dateKey]) >= launchDateObj)
    : -1;

  const labelInterval = getLabelInterval(sortedData.length);

  return (
    <div className="trend-bar-chart" style={{ height }}>
      {/* Y-axis labels */}
      {showYAxis && (
        <div className="chart-y-axis">
          <span className="y-label">{formatNumber(maxValue)}</span>
          <span className="y-label">{formatNumber(Math.round(maxValue / 2))}</span>
          <span className="y-label">0</span>
        </div>
      )}
      
      <div className="chart-main">
        <div className="chart-bars">
          {sortedData.map((item, index) => {
            const barHeight = ((item[valueKey] || 0) / maxValue) * 100;
            const isAfterLaunch = launchDateIndex >= 0 && index >= launchDateIndex;
            const isLaunchDay = index === launchDateIndex;
            const isHovered = hoveredBar === index;
            
            return (
              <div
                key={item[dateKey]}
                className="chart-bar-container"
                onMouseEnter={() => setHoveredBar(index)}
                onMouseLeave={() => setHoveredBar(null)}
              >
                <div
                  className={`chart-bar ${isAfterLaunch ? 'after-launch' : 'before-launch'} ${isLaunchDay ? 'launch-day' : ''} ${isHovered ? 'hovered' : ''}`}
                  style={{
                    height: `${Math.max(barHeight, 2)}%`,
                    '--before-color': beforeColor,
                    '--after-color': afterColor
                  }}
                />
                {isHovered && (
                  <div className="chart-tooltip">
                    <div className="tooltip-date">{formatShortDate(item[dateKey])}</div>
                    <div className="tooltip-row">
                      <span className="tooltip-label">{tooltipLabel}:</span>
                      <span className="tooltip-value">{(item[valueKey] || 0).toLocaleString()}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        
        {/* X-axis labels */}
        {showXAxis && (
          <div className="chart-x-axis">
            {sortedData.map((item, index) => {
              const isLastLabel = index === sortedData.length - 1;
              const prevLabelIndex = Math.floor((sortedData.length - 1) / labelInterval) * labelInterval;
              const tooCloseToEnd = isLastLabel && (sortedData.length - 1 - prevLabelIndex) < labelInterval * 0.6;
              
              if (tooCloseToEnd) return null;
              if (index % labelInterval !== 0 && !isLastLabel) return null;
              
              return (
                <span
                  key={item[dateKey]}
                  className="x-label"
                  style={{ left: `${(index / (sortedData.length - 1)) * 100}%` }}
                >
                  {formatShortDate(item[dateKey])}
                </span>
              );
            })}
          </div>
        )}
        
        {/* Launch date marker */}
        {launchDateIndex >= 0 && (
          <div
            className="launch-marker"
            style={{ left: `${(launchDateIndex / (sortedData.length - 1)) * 100}%` }}
          >
            <span className="launch-label">Launch</span>
          </div>
        )}
      </div>
      
      {/* Legend */}
      {showLegend && launchDate && (
        <div className="chart-legend">
          <span className="legend-item before">Before Launch</span>
          <span className="legend-item after">After Launch</span>
        </div>
      )}
    </div>
  );
}

export default TrendBarChart;

