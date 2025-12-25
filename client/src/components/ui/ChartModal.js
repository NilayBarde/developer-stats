import React, { useEffect, useState } from 'react';
import axios from 'axios';
import TrendBarChart from './TrendBarChart';
import { formatNumber, dailyClicksToArray, parseToISO, parseDate } from '../../utils/analyticsHelpers';
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
  const [eventDetails, setEventDetails] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  
  // Convert dailyClicks object to array if needed
  useEffect(() => {
    const dailyClicks = pageData.dailyClicks || {};
    const data = Array.isArray(dailyClicks) 
      ? dailyClicks 
      : dailyClicksToArray(dailyClicks);
    setChartData(data);
  }, [pageData]);

  // Fetch event details when modal opens
  useEffect(() => {
    const fetchEventDetails = async () => {
      if (!page.page) return;
      
      setLoadingEvents(true);
      try {
        const dates = datePresets[selectedPreset]?.getDates() || { 
          start: '2025-03-01', 
          end: new Date().toISOString().split('T')[0] 
        };
        const response = await axios.get(`/api/analytics/page-event-details`, {
          params: {
            page: page.page,
            startDate: dates.start,
            endDate: dates.end
          }
        });
        setEventDetails(response.data?.eventDetails || []);
      } catch (error) {
        console.error('Error fetching event details:', error);
        setEventDetails([]);
      } finally {
        setLoadingEvents(false);
      }
    };

    fetchEventDetails();
  }, [page.page, selectedPreset, datePresets]);

  // Calculate changePercent if not present, with proper edge case handling
  const rawComparison = pageData.comparison;
  const comparison = rawComparison ? (() => {
    const avgBefore = rawComparison.avgClicksBefore ?? rawComparison.avgBefore ?? 0;
    const avgAfter = rawComparison.avgClicksAfter ?? rawComparison.avgAfter ?? 0;
    
    let changePercent = rawComparison.changePercent;
    if (changePercent === undefined || changePercent === null || isNaN(changePercent)) {
      if (avgBefore > 0) {
        changePercent = Math.round(((avgAfter - avgBefore) / avgBefore) * 100);
      } else if (avgAfter > 0) {
        changePercent = 100; // From 0 to something
      } else {
        changePercent = null; // Both are 0, can't calculate
      }
    }
    
    return {
      ...rawComparison,
      avgClicksBefore: avgBefore,
      avgClicksAfter: avgAfter,
      changePercent
    };
  })() : null;
  
  const totalClicks = pageData.clicks || pageData.totalClicks || 0;

  // Calculate comparison for filtered data
  const calculateFilteredComparison = (dailyClicks) => {
    const launchDateObj = parseDate(launchDate);
    if (!launchDateObj) return null;
    
    let beforeTotal = 0, beforeDays = 0;
    let afterTotal = 0, afterDays = 0;
    
    Object.entries(dailyClicks).forEach(([date, data]) => {
      const dateObj = parseDate(date);
      const clicks = data?.clicks || (typeof data === 'number' ? data : 0);
      if (dateObj && dateObj < launchDateObj) {
        beforeTotal += clicks;
        beforeDays++;
      } else if (dateObj) {
        afterTotal += clicks;
        afterDays++;
      }
    });
    
    const avgClicksBefore = beforeDays > 0 ? Math.round(beforeTotal / beforeDays) : 0;
    const avgClicksAfter = afterDays > 0 ? Math.round(afterTotal / afterDays) : 0;
    const changePercent = avgClicksBefore > 0 
      ? Math.round(((avgClicksAfter - avgClicksBefore) / avgClicksBefore) * 100)
      : null;
    
    return { avgClicksBefore, avgClicksAfter, beforeDays, afterDays, changePercent };
  };

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
        const isoDate = parseToISO(date);
        if (isoDate >= dates.start && isoDate <= dates.end) {
          filteredClicks[date] = existingDailyClicks[date];
          const clicks = existingDailyClicks[date]?.clicks || existingDailyClicks[date] || 0;
          totalClicks += typeof clicks === 'number' ? clicks : 0;
        }
      });
      
      // Check if we have data for this range (at least some dates)
      const filteredDates = Object.keys(filteredClicks);
      if (filteredDates.length > 0) {
        // Recalculate comparison for filtered data
        const comparison = calculateFilteredComparison(filteredClicks);
        
        // Use filtered data - no need to fetch!
        setPageData({
          ...page,
          dailyClicks: filteredClicks,
          clicks: totalClicks,
          comparison
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
              {comparison.changePercent !== null && comparison.changePercent !== undefined && !isNaN(comparison.changePercent) && (
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
              <div className="label">Before Launch ({comparison.beforeDays ?? comparison.daysBefore ?? 0} days)</div>
              <div className="value">{formatNumber(comparison.avgClicksBefore)}/day</div>
            </div>
            <div className="modal-comparison-arrow">→</div>
            <div className="modal-comparison-item after">
              <div className="label">After Launch ({comparison.afterDays ?? comparison.daysAfter ?? 0} days)</div>
              <div className="value">{formatNumber(comparison.avgClicksAfter)}/day</div>
            </div>
          </div>
        )}

        {/* Top Event Details */}
        <div className="chart-modal-events">
          <h3>Top Event Details</h3>
          {loadingEvents ? (
            <div className="events-loading">Loading event details...</div>
          ) : eventDetails.length > 0 ? (
            <div className="events-list">
              {eventDetails.slice(0, 5).map((event, idx) => (
                <div key={idx} className="event-item">
                  <span className="event-rank">#{idx + 1}</span>
                  <span className="event-name">{event.eventDetail}</span>
                  <span className="event-clicks">{formatNumber(event.clicks)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="events-empty">No event details available</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ChartModal;
