import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import './App.css';
import StatsCard from './components/StatsCard';
import SourceSection from './components/SourceSection';
import DateFilter from './components/DateFilter';
import { calculateCombinedStats, getPRComparison, getCommentsComparison } from './utils/combinedStats';

function App() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [dateRange, setDateRange] = useState({
    label: 'July 2025 - Present',
    start: '2025-07-01',
    end: null,
    type: 'custom'
  });

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      let url = '/api/stats';
      const params = new URLSearchParams();
      
      if (dateRange.type === 'dynamic') {
        params.append('range', dateRange.range);
      } else {
        if (dateRange.start) params.append('start', dateRange.start);
        if (dateRange.end) params.append('end', dateRange.end);
      }
      
      if (params.toString()) {
        url += '?' + params.toString();
      }
      
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
  }, [dateRange]);

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
      <header className="app-header">
        <div>
          <h1>🚀 Engineering Stats Dashboard</h1>
          {stats && (stats.github?.dateRange || stats.gitlab?.dateRange) && (
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
        {/* Combined Stats */}
        {stats && (!stats.github?.error || !stats.gitlab?.error) && (() => {
          const combined = calculateCombinedStats(stats.github, stats.gitlab);
          const totalCommentsCombined = (stats.github?.totalComments || 0) + (stats.gitlab?.totalComments || 0);
          
          return (
            <div className="source-section combined">
              <h2>📊 Combined Overview</h2>
              <div className="cards-grid">
                <StatsCard
                  title="Total PRs/MRs"
                  value={combined.totalPRs}
                  subtitle={`${(stats.github?.total || 0)} GitHub, ${(stats.gitlab?.total || 0)} GitLab`}
                />
                <StatsCard
                  title="Avg PRs/MRs per Month"
                  value={combined.avgPRsPerMonth}
                  subtitle={getPRComparison(combined.avgPRsPerMonth)}
                />
                <StatsCard
                  title="Total Comments"
                  value={totalCommentsCombined}
                  subtitle={`Avg: ${combined.avgCommentsPerMonth}/month`}
                />
                <StatsCard
                  title="Avg Comments per Month"
                  value={combined.avgCommentsPerMonth}
                  subtitle={getCommentsComparison(combined.avgCommentsPerMonth)}
                />
              </div>
            </div>
          );
        })()}

        {/* GitHub Stats */}
        <SourceSection 
          stats={stats?.github} 
          source="github" 
          icon="📦"
          prLabel="PRs"
          monthlyPRsField="monthlyPRs"
          monthlyCommentsField="monthlyComments"
          avgPerMonthField="avgPRsPerMonth"
        />

        {stats?.github?.error && (
          <div className="source-section error">
            <h2>📦 GitHub</h2>
            <p className="error-message">{stats.github.error}</p>
          </div>
        )}

        {/* GitLab Stats */}
        <SourceSection 
          stats={stats?.gitlab} 
          source="gitlab" 
          icon="🔷"
          mrLabel="MRs"
          monthlyPRsField="monthlyMRs"
          monthlyCommentsField="monthlyComments"
          avgPerMonthField="avgMRsPerMonth"
        />

        {stats?.gitlab?.error && (
          <div className="source-section error">
            <h2>🔷 GitLab</h2>
            <p className="error-message">{stats.gitlab.error}</p>
          </div>
        )}

      </div>
    </div>
  );
}

export default App;

