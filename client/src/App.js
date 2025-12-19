import React, { useState, useEffect, useCallback } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import axios from 'axios';
import './App.css';
import GitSection from './components/GitSection';
import JiraSection from './components/JiraSection';
import DateFilter from './components/DateFilter';
import { getCurrentWorkYearStart, formatWorkYearLabel } from './utils/dateHelpers';
import { renderErrorSection } from './utils/sectionHelpers';
import CombinedOverview from './components/CombinedOverview';
import IssuesPage from './pages/IssuesPage';
import PRsPage from './pages/PRsPage';

function App() {
  const location = useLocation();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  
  const workYearStart = getCurrentWorkYearStart();
  const [dateRange, setDateRange] = useState({
    label: formatWorkYearLabel(workYearStart),
    start: workYearStart,
    end: null,
    type: 'custom'
  });

  const buildApiUrl = useCallback((dateRange) => {
    const params = new URLSearchParams();
    
    if (dateRange.type === 'dynamic') {
      params.append('range', dateRange.range);
    } else {
      if (dateRange.start) params.append('start', dateRange.start);
      if (dateRange.end) params.append('end', dateRange.end);
    }
    
    const queryString = params.toString();
    return queryString ? `/api/stats?${queryString}` : '/api/stats';
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      const url = buildApiUrl(dateRange);
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
  }, [dateRange, buildApiUrl]);

  useEffect(() => {
    fetchStats();
    // Refresh every 5 minutes
    const interval = setInterval(fetchStats, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  if (loading && !stats) {
    return (
      <div className="app">
        <div className="loading">Loading stats...</div>
      </div>
    );
  }

  return (
    <div className="app">
      <nav className="main-nav">
        <Link to="/" className={location.pathname === '/' ? 'active' : ''}>
          Dashboard
        </Link>
        <Link to="/issues" className={location.pathname === '/issues' ? 'active' : ''}>
          Jira Issues
        </Link>
        <Link to="/prs" className={location.pathname === '/prs' ? 'active' : ''}>
          PRs/MRs
        </Link>
      </nav>
      <Routes>
        <Route path="/issues" element={<IssuesPage />} />
        <Route path="/prs" element={<PRsPage />} />
        <Route path="/" element={
          <>
            <header className="app-header">
              <div>
                <h1>🚀 Engineering Stats Dashboard</h1>
                {stats && (stats.github?.dateRange || stats.gitlab?.dateRange || stats.jira?.dateRange) && (
                  <p className="work-year">
                    {dateRange.label}
                  </p>
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
            {/* Combined Overview */}
            {stats && <CombinedOverview githubStats={stats.github} gitlabStats={stats.gitlab} jiraStats={stats.jira} />}

            {/* Jira Stats */}
            <JiraSection stats={stats?.jira} />
            {renderErrorSection('jira', '📋', stats?.jira?.error)}

            {/* Combined Git Stats (GitHub + GitLab) */}
            <GitSection githubStats={stats?.github} gitlabStats={stats?.gitlab} />

          </div>
          </>
        } />
      </Routes>
    </div>
  );
}

export default App;

