import React, { useEffect, useState } from 'react';
import TrendBarChart from './TrendBarChart';
import { formatNumber, dailyClicksToArray } from '../../utils/analyticsHelpers';
import './ChartModal.css';

/**
 * A modal component for displaying an expanded chart view with date filtering
 */
function ChartModal({ 
  page, 
  onClose, 
  launchDate = '2025-12-01',
  valueKey = 'clicks',
  tooltipLabel = 'Bet Clicks',
  datePresets = {},
  currentPreset = 'sinceMarch'
}) {
  const [selectedPreset, setSelectedPreset] = useState(currentPreset);
  const [chartData, setChartData] = useState([]);
  const [pageData, setPageData] = useState(page);
  
  // Convert dailyClicks object to array if needed
  useEffect(() => {
    const dailyClicks = pageData.dailyClicks || {};
    const data = Array.isArray(dailyClicks) 
      ? dailyClicks 
      : dailyClicksToArray(dailyClicks);
    setChartData(data);
  }, [pageData]);

  const comparison = pageData.comparison;
  const totalClicks = pageData.clicks || pageData.totalClicks || 0;

  // Handle date preset change - filter existing data if possible
  const handlePresetChange = (preset) => {
    if (preset === selectedPreset) return;
    
    setSelectedPreset(preset);
    
    const dates = datePresets[preset]?.getDates();
    if (!dates) return;
    
    // Try to filter existing data instead of fetching
    const existingDailyClicks = page.dailyClicks || {};
    const existingDates = Object.keys(existingDailyClicks);
    
    if (existingDates.length > 0) {
      // Filter to only include dates within the requested range
      const filteredClicks = {};
      let totalClicks = 0;
      
      existingDates.forEach(date => {
        if (date >= dates.start && date <= dates.end) {
          filteredClicks[date] = existingDailyClicks[date];
          const clicks = existingDailyClicks[date]?.clicks || existingDailyClicks[date] || 0;
          totalClicks += typeof clicks === 'number' ? clicks : 0;
        }
      });
      
      // Check if we have data for this range (at least some dates)
      const filteredDates = Object.keys(filteredClicks);
      if (filteredDates.length > 0) {
        // Use filtered data - no need to fetch!
        setPageData({
          ...page,
          dailyClicks: filteredClicks,
          clicks: totalClicks,
          comparison: null // Comparison doesn't apply to filtered data
        });
        return;
      }
    }
    
    // If no existing data covers this range, we'd need to fetch
    // For now, just show what we have with a note
    console.log('Date range not covered by cached data');
  };
  
  // Handle escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Get date range label
  const getDateRangeLabel = () => {
    const preset = datePresets[selectedPreset];
    if (preset) {
      const dates = preset.getDates();
      return `${dates.start} to ${dates.end}`;
    }
    return 'Custom range';
  };

  return (
    <div className="chart-modal-overlay" onClick={onClose}>
      <div className="chart-modal" onClick={e => e.stopPropagation()}>
        <div className="chart-modal-header">
          <div>
            <h2>{page.label || page.title || 'Chart Details'}</h2>
            <div className="modal-subtitle">
              {page.page && <code>{page.page}</code>}
              <span> · {getDateRangeLabel()}</span>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Date Range Filter */}
        {Object.keys(datePresets).length > 0 && (
          <div className="modal-date-filter">
            {Object.entries(datePresets).map(([key, preset]) => (
              <button
                key={key}
                className={`date-filter-btn ${selectedPreset === key ? 'active' : ''}`}
                onClick={() => handlePresetChange(key)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        )}

        <div className="chart-modal-stats">
          <div className="modal-stat">
            <span className="stat-value">{formatNumber(totalClicks)}</span>
            <span className="stat-label">Total {tooltipLabel}</span>
          </div>
          {comparison && (
            <>
              <div className="modal-stat">
                <span className="stat-value">{formatNumber(comparison.avgClicksBefore || comparison.avgBefore)}</span>
                <span className="stat-label">Avg Before Launch</span>
              </div>
              <div className="modal-stat">
                <span className="stat-value">{formatNumber(comparison.avgClicksAfter || comparison.avgAfter)}</span>
                <span className="stat-label">Avg After Launch</span>
              </div>
              {comparison.changePercent !== null && comparison.changePercent !== undefined && (
                <div className={`modal-stat highlight ${comparison.changePercent >= 0 ? 'positive' : 'negative'}`}>
                  <span className="stat-value">
                    {comparison.changePercent >= 0 ? '+' : ''}{comparison.changePercent}%
                  </span>
                  <span className="stat-label">vs Pre-Launch</span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="chart-modal-chart">
          <TrendBarChart
            data={chartData}
            valueKey={valueKey}
            dateKey="date"
            launchDate={launchDate}
            height={300}
            tooltipLabel={tooltipLabel}
          />
        </div>

        {comparison && (
          <div className="chart-modal-comparison">
            <div className="modal-comparison-item before">
              <div className="label">Before Launch ({comparison.daysBefore} days)</div>
              <div className="value">{formatNumber(comparison.avgClicksBefore || comparison.avgBefore)}/day</div>
            </div>
            <div className="modal-comparison-arrow">→</div>
            <div className="modal-comparison-item after">
              <div className="label">After Launch ({comparison.daysAfter} days)</div>
              <div className="value">{formatNumber(comparison.avgClicksAfter || comparison.avgAfter)}/day</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ChartModal;
