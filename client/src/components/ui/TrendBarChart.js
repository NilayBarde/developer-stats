import React, { useState } from 'react';
import { formatNumber, formatShortDate, parseDate, getLabelInterval } from '../../utils/analyticsHelpers';
import './TrendBarChart.css';

// Location gating went to prod on Feb 19, 2025
const LOCATION_GATING_DATE = '2025-02-19';

/**
 * A reusable trend bar chart component that shows data over time
 * with optional launch date marker and before/after coloring.
 */
function TrendBarChart({
  data,
  valueKey = 'value',
  dateKey = 'date',
  launchDate = null,
  locationGatingDate = LOCATION_GATING_DATE,
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

  // Sort data chronologically and ensure numeric values
  const sortedData = [...data]
    .map(d => {
      // Handle different data formats - value might be nested or direct
      let value = d[valueKey];
      if (typeof value === 'object' && value !== null) {
        value = value.clicks || value.value || 0;
      }
      return {
        ...d,
        _value: Number(value) || 0
      };
    })
    .sort((a, b) => new Date(a[dateKey]) - new Date(b[dateKey]));
  
  const maxValue = Math.max(...sortedData.map(d => d._value), 1);
  
  // Find launch date index
  const launchDateObj = launchDate ? parseDate(launchDate) : null;
  const launchDateIndex = launchDateObj
    ? sortedData.findIndex(d => parseDate(d[dateKey]) >= launchDateObj)
    : -1;

  // Find location gating date index (Feb 19, 2025)
  const locationGatingDateObj = locationGatingDate ? parseDate(locationGatingDate) : null;
  const locationGatingIndex = locationGatingDateObj
    ? sortedData.findIndex(d => parseDate(d[dateKey]) >= locationGatingDateObj)
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
            const barHeight = (item._value / maxValue) * 100;
            const isAfterLaunch = launchDateIndex >= 0 && index >= launchDateIndex;
            const isLaunchDay = index === launchDateIndex;
            const isGeoGateDay = index === locationGatingIndex;
            const isHovered = hoveredBar === index;
            
            return (
              <div
                key={item[dateKey]}
                className="chart-bar-container"
                onMouseEnter={() => setHoveredBar(index)}
                onMouseLeave={() => setHoveredBar(null)}
              >
                <div
                  className={`chart-bar ${isAfterLaunch ? 'after-launch' : 'before-launch'} ${isLaunchDay ? 'launch-day' : ''} ${isGeoGateDay ? 'geo-gate-day' : ''} ${isHovered ? 'hovered' : ''}`}
                  style={{
                    height: `${Math.max(barHeight, 2)}%`,
                    '--before-color': beforeColor,
                    '--after-color': afterColor
                  }}
                />
                {isHovered && (
                  <div className="chart-tooltip">
                    <div className="tooltip-date">
                      {formatShortDate(item[dateKey])}
                      {isGeoGateDay && <span className="tooltip-event geo-gate"> · Geo-gate</span>}
                      {isLaunchDay && <span className="tooltip-event launch"> · Launch</span>}
                    </div>
                    <div className="tooltip-row">
                      <span className="tooltip-label">{tooltipLabel}:</span>
                      <span className="tooltip-value">{item._value.toLocaleString()}</span>
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
        
        {/* Location gating marker (Feb 19, 2025) */}
        {locationGatingIndex >= 0 && (
          <div
            className="event-marker location-gating"
            style={{ left: `${(locationGatingIndex / (sortedData.length - 1)) * 100}%` }}
          >
            <span className="event-label">Geo-gate</span>
          </div>
        )}
        
        {/* Launch date marker */}
        {launchDateIndex >= 0 && (
          <div
            className="event-marker launch"
            style={{ left: `${(launchDateIndex / (sortedData.length - 1)) * 100}%` }}
          >
            <span className="event-label">Launch</span>
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

