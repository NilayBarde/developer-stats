import React, { useEffect } from 'react';
import TrendBarChart from './TrendBarChart';
import { formatNumber, dailyClicksToArray } from '../../utils/analyticsHelpers';
import './ChartModal.css';

/**
 * A modal component for displaying an expanded chart view
 */
function ChartModal({ 
  page, 
  onClose, 
  launchDate = '2025-12-01',
  valueKey = 'clicks',
  tooltipLabel = 'Bet Clicks'
}) {
  // Convert dailyClicks object to array if needed
  const dailyClicks = page.dailyClicks || {};
  const chartData = Array.isArray(dailyClicks) 
    ? dailyClicks 
    : dailyClicksToArray(dailyClicks);
  
  const comparison = page.comparison;
  
  // Handle escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div className="chart-modal-overlay" onClick={onClose}>
      <div className="chart-modal" onClick={e => e.stopPropagation()}>
        <div className="chart-modal-header">
          <div>
            <h2>{page.label || page.title || 'Chart Details'}</h2>
            <div className="modal-subtitle">
              {page.page && <code>{page.page}</code>}
              <span> · Last 90 days</span>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="chart-modal-stats">
          <div className="modal-stat">
            <span className="stat-value">{formatNumber(page.clicks || page.totalClicks)}</span>
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
              <div className={`modal-stat highlight ${comparison.changePercent >= 0 ? 'positive' : 'negative'}`}>
                <span className="stat-value">
                  {comparison.changePercent >= 0 ? '+' : ''}{comparison.changePercent}%
                </span>
                <span className="stat-label">Change</span>
              </div>
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

