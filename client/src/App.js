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
import Skeleton from './components/ui/Skeleton';
import IssuesPage from './pages/IssuesPage';
import PRsPage from './pages/PRsPage';
import ProjectsPage from './pages/ProjectsPage';
import AnalyticsLandingPage from './pages/AnalyticsLandingPage';
import AnalyticsPage from './pages/AnalyticsPage';
import NFLGamecastPage from './pages/NFLGamecastPage';
import LeaderboardPage from './pages/LeaderboardPage';
import LogbookPage from './pages/LogbookPage';

function App() {
  const location = useLocation();
  // Progressive loading: separate state for each data source
  const [jiraStats, setJiraStats] = useState(null);
  const [gitStats, setGitStats] = useState(null);
  const [ctoiStats, setCtoiStats] = useState(null);
  const [benchmarks, setBenchmarks] = useState(null);
  const [benchmarksLoading, setBenchmarksLoading] = useState(false);
  const [jiraLoading, setJiraLoading] = useState(true);
  const [gitLoading, setGitLoading] = useState(true);
  const [ctoiLoading, setCtoiLoading] = useState(true);
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

  // Fetch Jira stats (usually faster)
  const fetchJiraStats = useCallback(async () => {
    // Always set loading to true first to show loading skeletons
    setJiraLoading(true);
    
    try {
      const url = buildApiUrl('/api/stats/jira', dateRange) + mockParam;
      const response = await axios.get(url);
      setJiraStats(response.data);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Error fetching Jira stats:', err);
    } finally {
      setJiraLoading(false);
    }
  }, [dateRange, mockParam]);

  // Fetch Git stats (GitHub + GitLab)
  const fetchGitStats = useCallback(async () => {
    try {
      setGitLoading(true);
      const url = buildApiUrl('/api/stats/git', dateRange) + mockParam;
      const response = await axios.get(url);
      setGitStats(response.data);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Error fetching Git stats:', err);
    } finally {
      setGitLoading(false);
    }
  }, [dateRange, mockParam]);

  // Fetch CTOI stats (matches engineering-metrics)
  const fetchCtoiStats = useCallback(async () => {
    // Always set loading to true first to show loading skeletons
    setCtoiLoading(true);
    
    try {
      const url = buildApiUrl('/api/stats/ctoi', dateRange) + mockParam;
      const response = await axios.get(url);
      setCtoiStats(response.data);
    } catch (err) {
      console.error('Error fetching CTOI stats:', err);
      // CTOI is optional, don't set error
    } finally {
      setCtoiLoading(false);
    }
  }, [dateRange, mockParam]);

  // Fetch benchmarks
  const fetchBenchmarks = useCallback(async () => {
    try {
      setBenchmarksLoading(true);
      const url = buildApiUrl('/api/stats/benchmarks', dateRange) + mockParam;
      const response = await axios.get(url, { timeout: 120000 }); // 2 minutes timeout (leaderboard can take a while)
      setBenchmarks(response.data);
    } catch (err) {
      console.error('Error fetching benchmarks:', err);
      // Benchmarks are optional, use fallback values
      setBenchmarks(null);
    } finally {
      setBenchmarksLoading(false);
    }
  }, [dateRange, mockParam]);

  // Fetch all stats in parallel (progressive)
  const fetchAllStats = useCallback(async () => {
    setError(null);
    // Start all fetches in parallel - each section updates independently
    fetchJiraStats();
    fetchGitStats();
    fetchCtoiStats();
    fetchBenchmarks();
  }, [fetchJiraStats, fetchGitStats, fetchCtoiStats, fetchBenchmarks]);

  useEffect(() => {
    // Only fetch stats on the dashboard route
    if (location.pathname === '/') {
      fetchAllStats();
      const interval = setInterval(fetchAllStats, 5 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [fetchAllStats, location.pathname]);

  const isAnyLoading = jiraLoading || gitLoading;

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
        <Link to={`/leaderboard${queryString}`} className={location.pathname === '/leaderboard' ? 'active' : ''}>
          Leaderboard
        </Link>
        <Link to={`/logbook${queryString}`} className={location.pathname === '/logbook' ? 'active' : ''}>
          Logbook
        </Link>
        {isMockMode && <span className="mock-indicator">🧪 MOCK MODE</span>}
      </nav>
      
      <Routes>
        <Route path="/issues" element={<IssuesPage />} />
        <Route path="/prs" element={<PRsPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/analytics" element={<AnalyticsLandingPage />} />
        <Route path="/analytics/draftkings" element={<AnalyticsPage />} />
        <Route path="/analytics/nfl-gamecast" element={<NFLGamecastPage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/logbook" element={<LogbookPage />} />
        <Route path="/" element={
          <>
            <header className="app-header">
              <div>
                <h1>Engineering Stats Dashboard</h1>
                <p className="work-year">{dateRange.label}</p>
              </div>
              <div className="header-controls">
                <DateFilter value={dateRange} onChange={setDateRange} />
                {lastUpdated && (
                  <p className="last-updated">
                    Last updated: {lastUpdated.toLocaleTimeString()}
                  </p>
                )}
                <button onClick={fetchAllStats} className="refresh-btn" disabled={isAnyLoading}>
                  {isAnyLoading ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
            </header>

            {error && <div className="error-banner">{error}</div>}

            <div className="stats-grid">
              {/* Combined Overview - always shows, with skeletons for loading parts */}
              <CombinedOverview 
                githubStats={gitStats?.github} 
                gitlabStats={gitStats?.gitlab} 
                jiraStats={jiraStats}
                gitLoading={gitLoading}
                jiraLoading={jiraLoading}
                dateRange={dateRange}
                benchmarks={benchmarks}
                benchmarksLoading={benchmarksLoading}
                reviewStats={gitStats?.reviewStats}
              />

              {/* Jira Section - loads independently */}
              <JiraSection 
                stats={jiraStats} 
                ctoiStats={ctoiLoading ? null : ctoiStats} 
                compact={true}
                loading={jiraLoading}
                ctoiLoading={ctoiLoading}
                benchmarks={benchmarks}
              />
              {!jiraLoading && renderErrorSection('jira', '', jiraStats?.error)}

              {/* Git Section - loads independently */}
              {gitLoading ? (
                <div className="source-section">
                  <Skeleton variant="text" width="200px" height="28px" />
                  <div className="cards-grid" style={{ marginTop: '20px' }}>
                    <Skeleton variant="stat-card" count={4} />
                  </div>
                </div>
              ) : (
                <GitSection githubStats={gitStats?.github} gitlabStats={gitStats?.gitlab} reviewStats={gitStats?.reviewStats} dateRange={dateRange} />
              )}
            </div>
          </>
        } />
      </Routes>
    </div>
  );
}

export default App;
