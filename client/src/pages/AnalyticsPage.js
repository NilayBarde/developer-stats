import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import axios from 'axios';
import clientCache from '../utils/clientCache';
import { formatNumber, isProjectLoading, dailyClicksToArray, DEFAULT_LAUNCH_DATE, parseToISO, parseDate } from '../utils/analyticsHelpers';
import TrendBarChart from '../components/ui/TrendBarChart';
import ChartModal from '../components/ui/ChartModal';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import Skeleton from '../components/ui/Skeleton';
import './AnalyticsPage.css';

// Date range presets
const DATE_PRESETS = {
  'last30': { label: 'Last 30 days', getDates: () => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
  }},
  'last90': { label: 'Last 90 days', getDates: () => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 90);
    return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
  }},
  'sinceMarch': { label: 'Since Mar 1, 2025', getDates: () => {
    const end = new Date();
    return { start: '2025-03-01', end: end.toISOString().split('T')[0] };
  }},
  'sinceDecLaunch': { label: 'Since Dec 1, 2025', getDates: () => {
    const end = new Date();
    return { start: '2025-12-01', end: end.toISOString().split('T')[0] };
  }},
};

// Estimated load times (updated based on actual timing data)
// Discovery: ~45s for day itemIds + matrix batches
// Matrix batches: 7 batches × ~18s each (45-day batches with 90s timeout)
// Total: ~175 seconds
const ESTIMATED_LOAD_SECONDS = {
  discovery: 45,       // Initial discovery phase (day itemIds query)
  perBatch: 18,        // Per matrix batch: ~18s API time
  expectedBatches: 7   // 300 days / 45 per batch = ~7 batches
};
// Total estimate: 45 + (18 * 7) = ~175 seconds

function AnalyticsPage() {
  const location = useLocation();
  const queryString = location.search;
  
  const [analyticsData, setAnalyticsData] = useState(null);  // Currently displayed (possibly filtered)
  const [fullData, setFullData] = useState(null);  // Original unfiltered data from server
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPage, setSelectedPage] = useState(null);
  const [datePreset, setDatePreset] = useState('sinceMarch'); // Default to since March 1
  const [loadProgress, setLoadProgress] = useState({ elapsed: 0, estimated: 0, phase: 'Starting...' });
  
  // Page type and league filters
  const [selectedPageType, setSelectedPageType] = useState('all');
  const [selectedLeague, setSelectedLeague] = useState('all');

  const pollIntervalRef = useRef(null);
  const pollCountRef = useRef(0);
  const loadStartRef = useRef(null);
  const progressIntervalRef = useRef(null);

  // Start progress timer
  const startProgressTimer = useCallback(() => {
    loadStartRef.current = Date.now();
    const estimatedTotal = ESTIMATED_LOAD_SECONDS.discovery + 
      (ESTIMATED_LOAD_SECONDS.perBatch * ESTIMATED_LOAD_SECONDS.expectedBatches);
    
    setLoadProgress({ elapsed: 0, estimated: estimatedTotal, phase: 'Discovering pages...' });
    
    // Clear any existing interval
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    
    progressIntervalRef.current = setInterval(() => {
      const elapsed = Math.round((Date.now() - loadStartRef.current) / 1000);
      let phase = 'Discovering pages...';
      if (elapsed > ESTIMATED_LOAD_SECONDS.discovery) {
        const batchProgress = Math.floor((elapsed - ESTIMATED_LOAD_SECONDS.discovery) / ESTIMATED_LOAD_SECONDS.perBatch);
        phase = `Fetching daily data (batch ${Math.min(batchProgress + 1, ESTIMATED_LOAD_SECONDS.expectedBatches)}/${ESTIMATED_LOAD_SECONDS.expectedBatches})...`;
      }
      setLoadProgress(prev => ({ ...prev, elapsed, phase }));
    }, 1000);
  }, []);
  
  const stopProgressTimer = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  }, []);

  const fetchAnalytics = useCallback(async (skipCache = false, preset = datePreset) => {
    const dates = DATE_PRESETS[preset].getDates();
    const cacheKey = `/api/project-analytics?start=${dates.start}&end=${dates.end}`;
    
    if (!skipCache) {
      const cached = clientCache.get(cacheKey, null);
      if (cached) {
        setAnalyticsData(cached);
        // Also set fullData if this is the widest range we have
        const cachedRange = cached?.dateRange;
        const existingRange = fullData?.dateRange;
        if (!existingRange || 
            (cachedRange && cachedRange.start <= existingRange.start && cachedRange.end >= existingRange.end)) {
          setFullData(cached);
        }
        setLoading(false);
        return cached;
      }
    }

    try {
      if (!analyticsData) setLoading(true);
      setError(null);
      startProgressTimer();
      
      // Check for mock mode via URL param (e.g., ?mock=true)
      const urlParams = new URLSearchParams(window.location.search);
      const mockParam = urlParams.get('mock') === 'true' ? '&mock=true' : '';
      
      const response = await axios.get(`/api/project-analytics?startDate=${dates.start}&endDate=${dates.end}${mockParam}`);
      stopProgressTimer();
      
      // Update estimated times based on actual timing
      if (response.data?.timing) {
        console.log('Server timing:', response.data.timing);
        // Could update ESTIMATED_LOAD_SECONDS here for future predictions
      }
      
      // Store displayed data
      setAnalyticsData(response.data);
      
      // Only update fullData if this is wider than what we have
      // (keeps the widest date range for client-side filtering)
      const newRange = response.data?.dateRange;
      const existingRange = fullData?.dateRange;
      if (!existingRange || 
          (newRange && newRange.start <= existingRange.start && newRange.end >= existingRange.end)) {
        setFullData(response.data);
      }
      clientCache.set(cacheKey, null, response.data);
      return response.data;
    } catch (err) {
      stopProgressTimer();
      setError(err.response?.data?.error || 'Failed to fetch analytics');
      console.error('Error fetching analytics:', err);
      return null;
    } finally {
      stopProgressTimer();
      setLoading(false);
    }
  }, [analyticsData, datePreset, fullData, startProgressTimer, stopProgressTimer]);

  // Handle date preset change - try to filter existing data first
  const handlePresetChange = (newPreset) => {
    setDatePreset(newPreset);
    pollCountRef.current = 0;
    
    const newDates = DATE_PRESETS[newPreset].getDates();
    // Use FULL data's date range for comparison (not the filtered analyticsData)
    const originalDates = fullData?.dateRange;
    
    // Check if new range is a subset of ORIGINAL data (can filter client-side)
    if (fullData && originalDates && 
        newDates.start >= originalDates.start && 
        newDates.end <= originalDates.end) {
      
      console.log(`Filtering client-side for ${newPreset}`);
      
      const filterStart = newDates.start;
      const filterEnd = newDates.end;
      
      // Helper to calculate comparison for filtered data
      const calculateFilteredComparison = (dailyClicks, launchDate) => {
        const launchDateObj = parseDate(launchDate);
        if (!launchDateObj) return null;
        
        let beforeTotal = 0, beforeDays = 0;
        let afterTotal = 0, afterDays = 0;
        
        Object.entries(dailyClicks).forEach(([date, data]) => {
          const dateObj = parseDate(date);
          const clicks = data?.clicks || 0;
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
        
        return { avgClicksBefore, avgClicksAfter, beforeDays, afterDays };
      };
      
      // Filter each project's daily clicks from FULL DATA to the new date range
      const filteredProjects = fullData.projects?.map(project => {
        const dailyClicks = project.clicks?.dailyClicks || {};
        const filteredDailyClicks = {};
        let totalClicks = 0;
        
        Object.entries(dailyClicks).forEach(([date, data]) => {
          const isoDate = parseToISO(date);
          if (isoDate >= filterStart && isoDate <= filterEnd) {
            filteredDailyClicks[date] = data;
            totalClicks += data?.clicks || 0;
          }
        });
        
        // Recalculate comparison based on filtered data
        const comparison = calculateFilteredComparison(filteredDailyClicks, DEFAULT_LAUNCH_DATE);
        
        return {
          ...project,
          clicks: {
            ...project.clicks,
            dailyClicks: filteredDailyClicks,
            totalClicks,
            comparison
          }
        };
      });
      
      // Recalculate grouped totals - maintain server structure
      // Server grouped structure: { pageType: { label, totalClicks, pages: [{page, label, clicks (number), dailyClicks, ...}] } }
      const grouped = {};
      const originalGrouped = fullData.grouped || {};
      
      filteredProjects?.forEach(project => {
        const pageType = project.pageType || project.epicKey?.split(':')[1] || 'other';
        const originalGroup = originalGrouped[pageType];
        
        if (!grouped[pageType]) {
          grouped[pageType] = { 
            label: originalGroup?.label || pageType, 
            totalClicks: 0, 
            pages: [] 
          };
        }
        
        const projectTotalClicks = project.clicks?.totalClicks || 0;
        grouped[pageType].totalClicks += projectTotalClicks;
        
        // Convert to the page structure that matches server response
        // Server pages have: { page, label, clicks (number), dailyClicks, comparison, ... }
        grouped[pageType].pages.push({
          page: project.epicKey,
          label: project.label,
          clicks: projectTotalClicks,  // Number, not object!
          dailyClicks: project.clicks?.dailyClicks || {},
          comparison: project.clicks?.comparison,
          draftKingsClicks: project.clicks?.draftKingsClicks,
          espnBetClicks: project.clicks?.espnBetClicks
        });
      });
      
      // Sort pages within each group by clicks
      Object.values(grouped).forEach(group => {
        group.pages.sort((a, b) => b.clicks - a.clicks);
      });
      
      // Recalculate engagement vs interstitial clicks
      const interstitialClicks = filteredProjects
        ?.filter(p => p.isInterstitial)
        .reduce((sum, p) => sum + (p.clicks?.totalClicks || 0), 0) || 0;
      const totalClicks = filteredProjects?.reduce((sum, p) => sum + (p.clicks?.totalClicks || 0), 0) || 0;
      const engagementClicks = totalClicks - interstitialClicks;
      
      // Recalculate byLeague breakdown (excluding interstitials)
      const byLeagueMap = {};
      filteredProjects?.filter(p => p.league && !p.isInterstitial).forEach(project => {
        const league = project.league;
        if (!byLeagueMap[league]) {
          byLeagueMap[league] = { league, totalClicks: 0, pages: [] };
        }
        byLeagueMap[league].totalClicks += project.clicks?.totalClicks || 0;
        byLeagueMap[league].pages.push(project.label);
      });
      const byLeague = Object.values(byLeagueMap).sort((a, b) => b.totalClicks - a.totalClicks);
      
      setAnalyticsData({
        ...fullData,  // Preserve all original data properties
        projects: filteredProjects,
        grouped,
        byLeague,
        engagementClicks,
        interstitialClicks,
        dateRange: { start: newDates.start, end: newDates.end },
        totalClicks
      });
      
      return;
    }
    
    // Need to fetch from server (new range extends beyond current data)
    console.log(`Fetching from server for ${newPreset} (outside cached range)`);
    fetchAnalytics(true, newPreset);
  };

  // Only fetch on initial mount, not when datePreset changes
  // (handlePresetChange handles date changes with client-side filtering)
  const initialFetchDone = useRef(false);
  useEffect(() => {
    if (!initialFetchDone.current) {
      initialFetchDone.current = true;
    fetchAnalytics();
    }
  }, [fetchAnalytics]);
  
  // Poll for updates if some projects are still loading
  useEffect(() => {
    if (!analyticsData || loading) return;
    
    // If we have timing data, discovery is complete - no need to poll
    if (analyticsData.timing?.pagesWithDailyData !== undefined) {
      return;
    }
    
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
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, [analyticsData, loading, fetchAnalytics]);

  // Calculate loading progress
  // Note: Server only fetches daily data for top 20 pages, so compare against
  // timing.pagesWithDailyData (actual pages with data) not totalPages (all discovered)
  const getLoadingProgress = () => {
    if (!analyticsData) return null;
    
    // If we have timing data, the server is done - no more loading
    if (analyticsData.timing?.pagesWithDailyData !== undefined) {
      return null; // Discovery complete
    }
    
    // Otherwise show progress based on projects with daily data
    const pagesWithData = analyticsData.projects?.filter(p => 
      Object.keys(p.clicks?.dailyClicks || {}).length > 0
    ).length || 0;
    const expectedPages = Math.min(analyticsData.totalPages || 0, 20); // We only fetch top 20
    
    if (pagesWithData < expectedPages && pollCountRef.current < 10) {
      return { pagesWithData, totalPages: expectedPages };
    }
    return null;
  };

  const loadingProgress = getLoadingProgress();

  // Get current date range for display
  const currentDates = DATE_PRESETS[datePreset].getDates();

  // Get available page types and leagues from data
  const availablePageTypes = analyticsData?.grouped 
    ? Object.entries(analyticsData.grouped).map(([key, group]) => ({ value: key, label: group.label }))
    : [];
  
  const availableLeagues = analyticsData?.byLeague 
    ? analyticsData.byLeague.map(l => ({ value: l.league, label: l.league }))
    : [];

  // Filter displayed data based on selected page type and league
  const getFilteredData = () => {
    if (!analyticsData) return null;
    if (selectedPageType === 'all' && selectedLeague === 'all') return analyticsData;

    // Filter projects based on selections
    const filteredProjects = analyticsData.projects?.filter(project => {
      const matchesPageType = selectedPageType === 'all' || project.pageType === selectedPageType;
      const matchesLeague = selectedLeague === 'all' || project.league === selectedLeague;
      return matchesPageType && matchesLeague;
    });

    // Rebuild grouped data from filtered projects
    const filteredGrouped = {};
    const pageTypeLabels = {
      'gamecast': 'Gamecast / Match',
      'scoreboard': 'Scoreboard', 
      'odds': 'Odds',
      'futures': 'Futures',
      'fantasy': 'Fantasy',
      'fightcenter': 'MMA Fight Center',
      'watchespn': 'WatchESPN',
      'schedule': 'Schedule',
      'story': 'Stories',
      'index': 'Index Pages',
      'interstitial': 'Confirmation (Interstitial)',
      'other': 'Other Pages'
    };

    filteredProjects?.forEach(project => {
      const pageType = project.pageType || 'other';
      if (!filteredGrouped[pageType]) {
        filteredGrouped[pageType] = {
          label: pageTypeLabels[pageType] || pageType,
          totalClicks: 0,
          pages: []
        };
      }
      filteredGrouped[pageType].totalClicks += project.clicks?.totalClicks || 0;
      filteredGrouped[pageType].pages.push({
        page: project.epicKey,
        label: project.label,
        league: project.league,
        clicks: project.clicks?.totalClicks || 0,
        dailyClicks: project.clicks?.dailyClicks || {},
        comparison: project.clicks?.comparison
      });
    });

    // Sort pages within each group by clicks
    Object.values(filteredGrouped).forEach(group => {
      group.pages.sort((a, b) => b.clicks - a.clicks);
    });

    // Calculate filtered totals
    const totalClicks = filteredProjects?.reduce((sum, p) => sum + (p.clicks?.totalClicks || 0), 0) || 0;
    const interstitialClicks = filteredProjects
      ?.filter(p => p.isInterstitial)
      .reduce((sum, p) => sum + (p.clicks?.totalClicks || 0), 0) || 0;
    const engagementClicks = totalClicks - interstitialClicks;

    // Recalculate byLeague for filtered data
    const byLeagueMap = {};
    filteredProjects?.filter(p => p.league && !p.isInterstitial).forEach(project => {
      const league = project.league;
      if (!byLeagueMap[league]) {
        byLeagueMap[league] = { league, totalClicks: 0, pages: [] };
      }
      byLeagueMap[league].totalClicks += project.clicks?.totalClicks || 0;
      byLeagueMap[league].pages.push(project.label);
    });
    const filteredByLeague = Object.values(byLeagueMap).sort((a, b) => b.totalClicks - a.totalClicks);

    return {
      ...analyticsData,
      projects: filteredProjects,
      grouped: filteredGrouped,
      byLeague: filteredByLeague,
      totalClicks,
      engagementClicks,
      interstitialClicks,
      totalPages: filteredProjects?.length || 0
    };
  };

  const filteredData = getFilteredData();

  // Reset filters when data changes significantly
  const handleResetFilters = () => {
    setSelectedPageType('all');
    setSelectedLeague('all');
  };

  const hasActiveFilters = selectedPageType !== 'all' || selectedLeague !== 'all';

  return (
    <div className="analytics-page">
      <nav className="breadcrumb">
        <Link to={`/analytics${queryString}`}>Analytics</Link>
        <span className="separator">/</span>
        <span className="current">DraftKings Integration</span>
      </nav>

      <header className="page-header">
        <div>
          <div className="header-title-row">
            <h1>DraftKings Integration</h1>
            <a 
              href="https://jira.disney.com/browse/SEWEB-59645" 
              target="_blank" 
              rel="noopener noreferrer"
              className="epic-link"
            >
              SEWEB-59645
            </a>
            <span className="launch-date">Launch: Dec 1, 2025</span>
          </div>
          <p className="date-label">{currentDates.start} to {currentDates.end} · Adobe Analytics</p>
        </div>
      </header>

      {/* Date Range Filter */}
      <div className="date-filter-bar">
        {Object.entries(DATE_PRESETS).map(([key, preset]) => (
          <button
            key={key}
            className={`date-filter-btn ${datePreset === key ? 'active' : ''}`}
            onClick={() => handlePresetChange(key)}
            disabled={loading}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Page Type and League Filters */}
      {!loading && analyticsData && (
        <div className="analytics-filters">
          <div className="filter-group">
            <label htmlFor="pageType-filter">Page Type</label>
            <select 
              id="pageType-filter"
              value={selectedPageType} 
              onChange={(e) => setSelectedPageType(e.target.value)}
              className="filter-select"
            >
              <option value="all">All Page Types</option>
              {availablePageTypes.map(pt => (
                <option key={pt.value} value={pt.value}>{pt.label}</option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label htmlFor="league-filter">League</label>
            <select 
              id="league-filter"
              value={selectedLeague} 
              onChange={(e) => setSelectedLeague(e.target.value)}
              className="filter-select"
            >
              <option value="all">All Leagues</option>
              {availableLeagues.map(l => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>
          {hasActiveFilters && (
            <button className="filter-reset-btn" onClick={handleResetFilters}>
              Clear Filters
            </button>
          )}
          {hasActiveFilters && (
            <span className="filter-status">
              Showing {filteredData?.totalPages || 0} of {analyticsData?.totalPages || 0} pages
            </span>
          )}
        </div>
      )}

      <div className="page-description">
        <p>
          Auto-discovered bet clicks across ESPN pages
          <span className="legend-inline">
            <span className="legend-item"><span className="legend-dot before"></span>Before launch</span>
            <span className="legend-item"><span className="legend-dot after"></span>After launch</span>
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

      {/* Summary Stats - Bet Clicks by League & Click Breakdown */}
      {!loading && filteredData && (
        <div className="analytics-summary-section top">
          {/* League Breakdown */}
          {filteredData.byLeague && filteredData.byLeague.length > 0 && (
            <div className="league-breakdown">
              <h3>Bet Clicks by League{hasActiveFilters ? ' (Filtered)' : ''}</h3>
              <div className="league-bars">
                {filteredData.byLeague.map(league => (
                  <div key={league.league} className="league-bar-item">
                    <div className="league-label">{league.league}</div>
                    <div className="league-bar-container">
                      <div 
                        className="league-bar-fill"
                        style={{ 
                          width: `${Math.min(100, (league.totalClicks / (filteredData.engagementClicks || filteredData.totalClicks)) * 100)}%` 
                        }}
                      />
                    </div>
                    <div className="league-clicks">{formatNumber(league.totalClicks)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Click Breakdown Card */}
          {filteredData.totalClicks > 0 && (
            <div className="confirmation-card">
              <h3>Click Breakdown{hasActiveFilters ? ' (Filtered)' : ''}</h3>
              <div className="click-breakdown">
                <div className="breakdown-item">
                  <div className="breakdown-bar-container">
                    <div 
                      className="breakdown-bar engagement"
                      style={{ width: `${((filteredData.engagementClicks || 0) / filteredData.totalClicks) * 100}%` }}
                    />
                    <div 
                      className="breakdown-bar interstitial"
                      style={{ width: `${((filteredData.interstitialClicks || 0) / filteredData.totalClicks) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="breakdown-legend">
                  <div className="legend-row">
                    <span className="legend-color engagement"></span>
                    <span className="legend-text">Content Pages</span>
                    <span className="legend-value">{formatNumber(filteredData.engagementClicks || 0)}</span>
                  </div>
                  <div className="legend-row">
                    <span className="legend-color interstitial"></span>
                    <span className="legend-text">Interstitial Modal</span>
                    <span className="legend-value">{formatNumber(filteredData.interstitialClicks || 0)}</span>
                  </div>
                </div>
              </div>
              <p className="confirmation-note">
                Interstitial = disclaimer modal before leaving ESPN
              </p>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="analytics-loading-container">
          <div className="analytics-loading">
            <LoadingSpinner />
            <div className="loading-progress">
              <div className="loading-phase">{loadProgress.phase}</div>
              <div className="loading-time">
                <span className="elapsed">{loadProgress.elapsed}s</span>
                <span className="separator"> / </span>
                <span className="estimated">~{loadProgress.estimated}s estimated</span>
              </div>
              {loadProgress.estimated > 0 && (
                <div className="progress-bar">
                  <div 
                    className="progress-fill" 
                    style={{ width: `${Math.min(100, (loadProgress.elapsed / loadProgress.estimated) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          </div>
          {/* Skeleton preview of expected content */}
          <div className="analytics-skeleton-preview">
            <div className="skeleton-summary-grid">
              <Skeleton variant="stat-card" count={3} />
            </div>
            <div className="skeleton-chart-area">
              <Skeleton variant="chart" />
            </div>
            <div className="skeleton-pages-list">
              <Skeleton variant="list-item" count={6} />
            </div>
          </div>
        </div>
      ) : !analyticsData || analyticsData.projects?.length === 0 ? (
        <div className="no-data-message">
          <p>No analytics configured</p>
          <p className="hint">Add project analytics in <code>server/config/projectAnalytics.json</code></p>
        </div>
      ) : filteredData?.projects?.length === 0 ? (
        <div className="no-data-message">
          <p>No pages match the selected filters</p>
          <button className="filter-reset-btn primary" onClick={handleResetFilters}>
            Clear Filters
          </button>
        </div>
      ) : (
        <div className="analytics-grouped">
          {filteredData?.grouped && Object.entries(filteredData.grouped).map(([pageType, group]) => (
            <PageTypeGroup
              key={pageType}
              pageType={pageType}
              group={group}
              analyticsData={filteredData}
              fullData={fullData}
              pollCount={pollCountRef.current}
              onSelectPage={setSelectedPage}
            />
          ))}
        </div>
      )}

      {/* Summary Footer */}
      {filteredData && (
        <div className="analytics-summary">
          <p>
            <strong>{filteredData.totalPages}</strong> pages with bet clicks{hasActiveFilters ? ` (${analyticsData?.totalPages} total)` : ''} · 
            <strong> {formatNumber(filteredData.totalClicks)}</strong> total clicks · 
            {filteredData.dateRange?.start} to {filteredData.dateRange?.end}
          </p>
          <p className="method-note">Data source: {filteredData.method}</p>
        </div>
      )}

      {/* Expanded Chart Modal */}
      {selectedPage && (
        <ChartModal 
          page={selectedPage} 
          onClose={() => setSelectedPage(null)}
          launchDate={DEFAULT_LAUNCH_DATE}
          tooltipLabel="Bet Clicks"
          datePresets={DATE_PRESETS}
          currentPreset={datePreset}
        />
      )}
    </div>
  );
}

/**
 * Page type group component - displays a group of pages
 */
function PageTypeGroup({ pageType, group, analyticsData, fullData, pollCount, onSelectPage }) {
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
            fullData={fullData}
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
function AnalyticsCard({ page, analyticsData, fullData, pollCount, onSelect }) {
  const project = analyticsData.projects?.find(p => p.epicKey === page.page) || page;
                  const dailyClicks = project.clicks?.dailyClicks || page.dailyClicks || {};
                  const comparison = project.clicks?.comparison || page.comparison;
                  const totalClicks = project.clicks?.totalClicks || page.clicks || 0;
                  const hasData = Object.keys(dailyClicks).length > 0;
                  
  // Check if still loading
  const isStillLoading = totalClicks > 0 && !hasData && pollCount < 10;
  
  // Prepare chart data - pass date range to fill in missing dates with 0
  const chartData = dailyClicksToArray(dailyClicks, analyticsData?.dateRange);
  
  // Get full daily clicks from unfiltered data for modal filtering
  const fullProject = fullData?.projects?.find(p => p.epicKey === page.page);
  const fullDailyClicks = fullProject?.clicks?.dailyClicks || dailyClicks;
                  
                  // Prepare page data for modal
                  const pageData = {
                    ...page,
                    dailyClicks,
                    fullDailyClicks, // Include full data for modal filtering
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
                        {page.rawSamples && page.rawSamples.length > 0 && (
                          <details className="raw-samples">
                            <summary>View sources ({page.rawSamples.length})</summary>
                            <ul>
                              {page.rawSamples.map((sample, i) => (
                                <li key={i} title={sample.value}>
                                  {sample.value.length > 60 ? sample.value.substring(0, 60) + '...' : sample.value}
                                  <span className="sample-clicks">({formatNumber(sample.clicks)})</span>
                                </li>
                              ))}
                            </ul>
                          </details>
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
                          {comparison.avgClicksBefore > 0 && (
                            <span className={`percent-change ${comparison.avgClicksAfter >= comparison.avgClicksBefore ? 'positive' : 'negative'}`}>
                              {comparison.avgClicksAfter >= comparison.avgClicksBefore ? '+' : ''}
                              {Math.round(((comparison.avgClicksAfter - comparison.avgClicksBefore) / comparison.avgClicksBefore) * 100)}%
                            </span>
                          )}
                        </div>
                      )}
                      
                      <div className="card-footer">
                        <code>{page.page}</code>
                      </div>
    </div>
  );
}

export default AnalyticsPage;
