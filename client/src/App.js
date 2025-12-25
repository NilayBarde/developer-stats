import React, { useState, useEffect, useCallback } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import axios from 'axios';
import './App.css';
import GitSection from './components/GitSection';
import JiraSection from './components/JiraSection';
import DateFilter from './components/DateFilter';
import { getCurrentWorkYearStart, formatWorkYearLabel } from './utils/dateHelpers';
import { buildApiUrl } from './utils/apiHelpers';
import { renderErrorSection } from './utils/sectionHelpers';
import CombinedOverview from './components/CombinedOverview';
import LoadingSpinner from './components/ui/LoadingSpinner';
import IssuesPage from './pages/IssuesPage';
import PRsPage from './pages/PRsPage';
import ProjectsPage from './pages/ProjectsPage';
import AnalyticsLandingPage from './pages/AnalyticsLandingPage';
import AnalyticsPage from './pages/AnalyticsPage';
import NFLGamecastPage from './pages/NFLGamecastPage';
import PromotionPage from './pages/PromotionPage';

function App() {
  const location = useLocation();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  
  // Preserve query params (like ?mock=true) when navigating
  const queryString = location.search;
  const isMockMode = new URLSearchParams(queryString).get('mock') === 'true';
  const mockParam = isMockMode ? '&mock=true' : '';
  
  const workYearStart = getCurrentWorkYearStart();
  const [dateRange, setDateRange] = useState({
    label: formatWorkYearLabel(workYearStart),
    start: workYearStart,
    end: null,
    type: 'custom'
  });

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      const url = buildApiUrl('/api/stats', dateRange) + mockParam;
      const response = await axios.get(url);
      setStats(response.data);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError('Failed to fetch stats. Please check your API configuration.');
      console.error('Error fetching stats:', err);
    } finally {
      setLoading(false);
    }
  }, [dateRange, mockParam]);

  useEffect(() => {
    // Only fetch stats on the dashboard route
    if (location.pathname === '/') {
      fetchStats();
      const interval = setInterval(fetchStats, 5 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [fetchStats, location.pathname]);

  return (
    <div className="app">
      <nav className="main-nav">
        <Link to={`/${queryString}`} className={location.pathname === '/' ? 'active' : ''}>
          Dashboard
        </Link>
        <Link to={`/issues${queryString}`} className={location.pathname === '/issues' ? 'active' : ''}>
          Jira Issues
        </Link>
        <Link to={`/prs${queryString}`} className={location.pathname === '/prs' ? 'active' : ''}>
          PRs/MRs
        </Link>
        <Link to={`/projects${queryString}`} className={location.pathname === '/projects' ? 'active' : ''}>
          Projects
        </Link>
        <Link to={`/analytics${queryString}`} className={location.pathname.startsWith('/analytics') ? 'active' : ''}>
          Analytics
        </Link>
        <Link to={`/promotion${queryString}`} className={location.pathname === '/promotion' ? 'active' : ''}>
          Promotion
        </Link>
        {isMockMode && <span className="mock-indicator">MOCK MODE</span>}
      </nav>
      
      <Routes>
        <Route path="/issues" element={<IssuesPage />} />
        <Route path="/prs" element={<PRsPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/analytics" element={<AnalyticsLandingPage />} />
        <Route path="/analytics/draftkings" element={<AnalyticsPage />} />
        <Route path="/analytics/nfl-gamecast" element={<NFLGamecastPage />} />
        <Route path="/promotion" element={<PromotionPage />} />
        <Route path="/" element={
          <>
            <header className="app-header">
              <div>
                <h1>Engineering Stats Dashboard</h1>
                {stats && (
                  <p className="work-year">{dateRange.label}</p>
                )}
              </div>
              <div className="header-controls">
                <DateFilter value={dateRange} onChange={setDateRange} />
                {lastUpdated && (
                  <p className="last-updated">
                    Last updated: {lastUpdated.toLocaleTimeString()}
                  </p>
                )}
                <button onClick={fetchStats} className="refresh-btn" disabled={loading}>
                  {loading ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
            </header>

            {error && <div className="error-banner">{error}</div>}

            <div className="stats-grid">
              {loading ? (
                <>
                  <LoadingSpinner text="Loading overview..." />
                  <LoadingSpinner text="Loading Jira stats..." />
                  <LoadingSpinner text="Loading Git stats..." />
                </>
              ) : (
                <>
                  {stats && <CombinedOverview githubStats={stats.github} gitlabStats={stats.gitlab} jiraStats={stats.jira} />}
                  <JiraSection stats={stats?.jira} />
                  {renderErrorSection('jira', '', stats?.jira?.error)}
                  <GitSection githubStats={stats?.github} gitlabStats={stats?.gitlab} />
                </>
              )}
            </div>
          </>
        } />
      </Routes>
    </div>
  );
}

export default App;
