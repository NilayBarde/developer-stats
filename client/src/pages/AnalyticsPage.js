import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import clientCache from '../utils/clientCache';
import { formatNumber, isProjectLoading, dailyClicksToArray, DEFAULT_LAUNCH_DATE } from '../utils/analyticsHelpers';
import TrendBarChart from '../components/ui/TrendBarChart';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import ChartModal from '../components/ui/ChartModal';
import './AnalyticsPage.css';

function AnalyticsPage() {
  const [analyticsData, setAnalyticsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPage, setSelectedPage] = useState(null);

  const pollIntervalRef = useRef(null);
  const pollCountRef = useRef(0);

  const fetchAnalytics = useCallback(async (skipCache = false) => {
    const cacheKey = '/api/project-analytics';
    
    if (!skipCache) {
      const cached = clientCache.get(cacheKey, null);
      if (cached) {
        setAnalyticsData(cached);
        setLoading(false);
        return cached;
      }
    }

    try {
      if (!analyticsData) setLoading(true);
      setError(null);
      const response = await axios.get('/api/project-analytics');
      setAnalyticsData(response.data);
      clientCache.set(cacheKey, null, response.data);
      return response.data;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to fetch analytics');
      console.error('Error fetching analytics:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [analyticsData]);

  useEffect(() => {
    fetchAnalytics();
  }, []);
  
  // Poll for updates if some projects are still loading
  useEffect(() => {
    if (!analyticsData || loading) return;
    
    const hasLoadingProjects = analyticsData.projects?.some(isProjectLoading);
    
    if (hasLoadingProjects && pollCountRef.current < 10) {
      pollIntervalRef.current = setTimeout(async () => {
        pollCountRef.current++;
        console.log(`Polling for updates (${pollCountRef.current}/10)...`);
        await fetchAnalytics(true);
      }, 5000);
    }
    
    return () => {
      if (pollIntervalRef.current) {
        clearTimeout(pollIntervalRef.current);
      }
    };
  }, [analyticsData, loading, fetchAnalytics]);

  // Calculate loading progress
  const getLoadingProgress = () => {
    if (!analyticsData) return null;
    const pagesWithData = analyticsData.projects?.filter(p => 
      Object.keys(p.clicks?.dailyClicks || {}).length > 0
    ).length || 0;
    const totalPages = analyticsData.totalPages || 0;
    if (pagesWithData < totalPages && pollCountRef.current < 10) {
      return { pagesWithData, totalPages };
    }
    return null;
  };

  const loadingProgress = getLoadingProgress();

  return (
    <div className="analytics-page">
      <header className="page-header">
        <div>
          <h1>Analytics</h1>
          <p className="date-label">Last 90 days · Adobe Analytics</p>
        </div>
      </header>

      <div className="page-description">
        <p>
          Auto-discovered bet clicks across ESPN pages (DraftKings launch: Dec 1, 2025)
          <span className="legend-inline">
            <span className="legend-dot before"></span> Before launch
            <span className="legend-dot after"></span> After launch
          </span>
        </p>
        {loadingProgress && (
          <p className="loading-progress">
            <span className="spinner-small"></span>
            Loading daily data... {loadingProgress.pagesWithData}/{loadingProgress.totalPages} pages
          </p>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="loading-section">
          <LoadingSpinner size="large" text="Loading analytics..." />
        </div>
      ) : !analyticsData || analyticsData.projects?.length === 0 ? (
        <div className="no-data-message">
          <p>No analytics configured</p>
          <p className="hint">Add project analytics in <code>server/config/projectAnalytics.json</code></p>
        </div>
      ) : (
        <div className="analytics-grouped">
          {analyticsData.grouped && Object.entries(analyticsData.grouped).map(([pageType, group]) => (
            <PageTypeGroup
              key={pageType}
              pageType={pageType}
              group={group}
              analyticsData={analyticsData}
              pollCount={pollCountRef.current}
              onSelectPage={setSelectedPage}
            />
          ))}
        </div>
      )}

      {/* Summary */}
      {analyticsData && (
        <div className="analytics-summary">
          <p>
            <strong>{analyticsData.totalPages}</strong> pages with bet clicks · 
            <strong> {formatNumber(analyticsData.totalClicks)}</strong> total clicks · 
            {analyticsData.dateRange?.start} to {analyticsData.dateRange?.end}
          </p>
          <p className="method-note">Data source: {analyticsData.method}</p>
        </div>
      )}

      {/* Expanded Chart Modal */}
      {selectedPage && (
        <ChartModal 
          page={selectedPage} 
          onClose={() => setSelectedPage(null)}
          launchDate={DEFAULT_LAUNCH_DATE}
          tooltipLabel="Bet Clicks"
        />
      )}
    </div>
  );
}

/**
 * Page type group component - displays a group of pages
 */
function PageTypeGroup({ pageType, group, analyticsData, pollCount, onSelectPage }) {
  return (
    <div className="page-type-group">
      <div className="group-header-row">
        <h2 className="group-header">{group.label}</h2>
        <span className="group-stats">
          {group.pages.length} pages · {formatNumber(group.totalClicks || group.pages.reduce((sum, p) => sum + p.clicks, 0))} clicks
        </span>
      </div>
      
      <div className="analytics-grid">
        {group.pages.map((page) => (
          <AnalyticsCard
            key={page.page}
            page={page}
            analyticsData={analyticsData}
            pollCount={pollCount}
            onSelect={onSelectPage}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Analytics card component - displays a single page's analytics
 */
function AnalyticsCard({ page, analyticsData, pollCount, onSelect }) {
  const project = analyticsData.projects?.find(p => p.epicKey === page.page) || page;
  const dailyClicks = project.clicks?.dailyClicks || page.dailyClicks || {};
  const comparison = project.clicks?.comparison || page.comparison;
  const totalClicks = project.clicks?.totalClicks || page.clicks || 0;
  const hasData = Object.keys(dailyClicks).length > 0;
  
  // Check if still loading
  const isStillLoading = totalClicks > 0 && !hasData && pollCount < 10;
  
  // Prepare chart data
  const chartData = dailyClicksToArray(dailyClicks);
  
  // Prepare page data for modal
  const pageData = {
    ...page,
    dailyClicks,
    comparison,
    clicks: totalClicks
  };
  
  return (
    <div 
      className={`analytics-card compact ${hasData ? 'clickable' : ''}`}
      onClick={() => hasData && onSelect(pageData)}
      style={{ cursor: hasData ? 'pointer' : 'default' }}
    >
      <div className="card-header">
        <h3>{page.label}</h3>
        {comparison?.changePercent !== undefined && (
          <span className={`change-badge ${comparison.changePercent >= 0 ? 'positive' : 'negative'}`}>
            {comparison.changePercent >= 0 ? '+' : ''}{comparison.changePercent}%
          </span>
        )}
      </div>
      
      <div className="card-stats">
        <span className="total-clicks">{formatNumber(totalClicks)}</span>
        <span className="clicks-label">total clicks</span>
      </div>

      {/* Chart */}
      {hasData ? (
        <div className="chart-clickable">
          <TrendBarChart
            data={chartData}
            valueKey="clicks"
            dateKey="date"
            launchDate={project.launchDate || DEFAULT_LAUNCH_DATE}
            height={120}
            showLegend={false}
            showYAxis={false}
            showXAxis={false}
            tooltipLabel="Bet Clicks"
          />
        </div>
      ) : isStillLoading ? (
        <LoadingSpinner size="small" text="Loading..." />
      ) : (
        <div className="chart-empty small">No daily data</div>
      )}

      {/* Before/After */}
      {comparison && (
        <div className="mini-comparison">
          <span className="before">{formatNumber(comparison.avgClicksBefore)}/day</span>
          <span className="arrow">→</span>
          <span className="after">{formatNumber(comparison.avgClicksAfter)}/day</span>
        </div>
      )}
      
      <div className="card-footer">
        <code>{page.page}</code>
      </div>
    </div>
  );
}

export default AnalyticsPage;
