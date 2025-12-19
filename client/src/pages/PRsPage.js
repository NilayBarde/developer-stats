import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { format } from 'date-fns';
import DateFilter from '../components/DateFilter';
import { getCurrentWorkYearStart, formatWorkYearLabel } from '../utils/dateHelpers';
import GitSection from '../components/GitSection';
import { renderErrorSection } from '../utils/sectionHelpers';
import './IssuesPage.css';

function PRsPage() {
  const [prs, setPRs] = useState([]);
  const [mrs, setMRs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterSource, setFilterSource] = useState('all'); // 'all', 'github', 'gitlab'
  const [filterRepo, setFilterRepo] = useState('all');
  const [sortBy, setSortBy] = useState('updated');
  const [sortOrder, setSortOrder] = useState('desc');
  
  const workYearStart = getCurrentWorkYearStart();
  const [dateRange, setDateRange] = useState({
    label: formatWorkYearLabel(workYearStart),
    start: workYearStart,
    end: null,
    type: 'custom'
  });

  const buildPRsApiUrl = useCallback((dateRange) => {
    const params = new URLSearchParams();
    
    if (dateRange.type === 'dynamic') {
      params.append('range', dateRange.range);
    } else {
      if (dateRange.start) params.append('start', dateRange.start);
      if (dateRange.end) params.append('end', dateRange.end);
    }
    
    const queryString = params.toString();
    return queryString ? `/api/prs?${queryString}` : '/api/prs';
  }, []);

  const buildMRsApiUrl = useCallback((dateRange) => {
    const params = new URLSearchParams();
    
    if (dateRange.type === 'dynamic') {
      params.append('range', dateRange.range);
    } else {
      if (dateRange.start) params.append('start', dateRange.start);
      if (dateRange.end) params.append('end', dateRange.end);
    }
    
    const queryString = params.toString();
    return queryString ? `/api/mrs?${queryString}` : '/api/mrs';
  }, []);

  const buildStatsApiUrl = useCallback((dateRange) => {
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

  const fetchPRs = useCallback(async () => {
    try {
      const url = buildPRsApiUrl(dateRange);
      const response = await axios.get(url);
      const prsData = response.data.prs || [];
      // Add source indicator
      return prsData.map(pr => ({ ...pr, _source: 'github' }));
    } catch (err) {
      console.error('Error fetching PRs:', err);
      return [];
    }
  }, [dateRange, buildPRsApiUrl]);

  const fetchMRs = useCallback(async () => {
    try {
      const url = buildMRsApiUrl(dateRange);
      const response = await axios.get(url);
      const mrsData = response.data.mrs || [];
      // Add source indicator
      return mrsData.map(mr => ({ ...mr, _source: 'gitlab' }));
    } catch (err) {
      console.error('Error fetching MRs:', err);
      return [];
    }
  }, [dateRange, buildMRsApiUrl]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [prsData, mrsData] = await Promise.all([
        fetchPRs(),
        fetchMRs()
      ]);
      
      setPRs(prsData);
      setMRs(mrsData);
    } catch (err) {
      setError('Failed to fetch PRs/MRs. Please check your API configuration.');
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  }, [fetchPRs, fetchMRs]);

  const fetchStats = useCallback(async () => {
    try {
      setStatsLoading(true);
      const url = buildStatsApiUrl(dateRange);
      const response = await axios.get(url);
      setStats(response.data);
    } catch (err) {
      console.error('Error fetching stats:', err);
    } finally {
      setStatsLoading(false);
    }
  }, [dateRange, buildStatsApiUrl]);

  useEffect(() => {
    fetchData();
    fetchStats();
  }, [fetchData, fetchStats]);

  // Combine PRs and MRs
  const allItems = [...prs, ...mrs];

  // Get unique statuses, sources, and repos for filters
  const statuses = [...new Set(allItems.map(item => {
    if (item._source === 'github') {
      if (item.state === 'closed' && item.pull_request?.merged_at) return 'merged';
      return item.state;
    } else {
      return item.state;
    }
  }).filter(Boolean))].sort();
  
  const sources = [...new Set(allItems.map(item => item._source).filter(Boolean))].sort();
  
  const repos = [...new Set(allItems.map(item => {
    if (item._source === 'github') {
      if (item.repository_url) {
        const match = item.repository_url.match(/repos\/(.+)$/);
        return match ? match[1] : null;
      }
    } else {
      return item.project_id?.toString() || null;
    }
    return null;
  }).filter(Boolean))].sort();

  // Filter items
  const filteredItems = allItems.filter(item => {
    if (filterStatus !== 'all') {
      const itemStatus = item._source === 'github'
        ? (item.state === 'closed' && item.pull_request?.merged_at ? 'merged' : item.state)
        : item.state;
      if (itemStatus !== filterStatus) return false;
    }
    if (filterSource !== 'all' && item._source !== filterSource) return false;
    if (filterRepo !== 'all') {
      if (item._source === 'github') {
        const repoMatch = item.repository_url?.match(/repos\/(.+)$/);
        const repo = repoMatch ? repoMatch[1] : null;
        if (repo !== filterRepo) return false;
      } else {
        if (item.project_id?.toString() !== filterRepo) return false;
      }
    }
    return true;
  });

  // Calculate filtered stats
  const calculateFilteredStats = (filteredItems) => {
    const githubItems = filteredItems.filter(item => item._source === 'github');
    const gitlabItems = filteredItems.filter(item => item._source === 'gitlab');
    
    const total = filteredItems.length;
    const merged = filteredItems.filter(item => {
      if (item._source === 'github') {
        return item.state === 'closed' && item.pull_request?.merged_at;
      } else {
        return item.state === 'merged';
      }
    }).length;
    const open = filteredItems.filter(item => {
      if (item._source === 'github') {
        return item.state === 'open';
      } else {
        return item.state === 'opened';
      }
    }).length;
    const closed = filteredItems.filter(item => {
      if (item._source === 'github') {
        return item.state === 'closed' && !item.pull_request?.merged_at;
      } else {
        return item.state === 'closed';
      }
    }).length;

    // Calculate average PRs/MRs per month
    const itemsByMonth = {};
    filteredItems.forEach(item => {
      const date = item.created_at ? new Date(item.created_at) : null;
      if (date && !isNaN(date.getTime())) {
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const monthKey = `${date.getFullYear()}-${month}`;
        itemsByMonth[monthKey] = (itemsByMonth[monthKey] || 0) + 1;
      }
    });
    const monthlyCounts = Object.values(itemsByMonth);
    const avgPerMonth = monthlyCounts.length > 0
      ? monthlyCounts.reduce((a, b) => a + b, 0) / monthlyCounts.length
      : 0;

    // Calculate last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const last30Days = filteredItems.filter(item => {
      const updatedDate = item.updated_at ? new Date(item.updated_at) : null;
      return updatedDate && updatedDate >= thirtyDaysAgo;
    }).length;

    return {
      total,
      merged,
      open,
      closed,
      avgPRsPerMonth: Math.round(avgPerMonth * 10) / 10,
      avgMRsPerMonth: Math.round(avgPerMonth * 10) / 10,
      last30Days,
      github: {
        total: githubItems.length,
        merged: githubItems.filter(item => item.state === 'closed' && item.pull_request?.merged_at).length,
        open: githubItems.filter(item => item.state === 'open').length
      },
      gitlab: {
        total: gitlabItems.length,
        merged: gitlabItems.filter(item => item.state === 'merged').length,
        open: gitlabItems.filter(item => item.state === 'opened').length
      }
    };
  };

  const filteredStats = calculateFilteredStats(filteredItems);

  // Merge filtered stats with API stats
  const displayStats = stats ? {
      github: stats.github ? {
        ...stats.github,
        ...filteredStats.github,
        total: filteredStats.github.total,
        merged: filteredStats.github.merged,
        open: filteredStats.github.open,
        avgPRsPerMonth: filteredStats.avgPRsPerMonth,
        last30Days: filteredStats.last30Days
      } : null,
      gitlab: stats.gitlab ? {
        ...stats.gitlab,
        ...filteredStats.gitlab,
        total: filteredStats.gitlab.total,
        merged: filteredStats.gitlab.merged,
        open: filteredStats.gitlab.open,
        avgMRsPerMonth: filteredStats.avgMRsPerMonth,
        last30Days: filteredStats.last30Days
      } : null
  } : null;

  // Sort items
  const filteredAndSortedItems = filteredItems.sort((a, b) => {
    let aValue, bValue;
    
    switch (sortBy) {
      case 'title':
        aValue = a.title || '';
        bValue = b.title || '';
        break;
      case 'source':
        aValue = a._source || '';
        bValue = b._source || '';
        break;
      case 'repo':
        if (a._source === 'github') {
          const repoA = a.repository_url?.match(/repos\/(.+)$/)?.[1] || '';
          const repoB = b.repository_url?.match(/repos\/(.+)$/)?.[1] || '';
          aValue = repoA;
          bValue = repoB;
        } else {
          aValue = a.project_id?.toString() || '';
          bValue = b.project_id?.toString() || '';
        }
        break;
      case 'created':
        aValue = new Date(a.created_at || 0);
        bValue = new Date(b.created_at || 0);
        break;
      case 'merged':
        if (a._source === 'github') {
          aValue = a.pull_request?.merged_at ? new Date(a.pull_request.merged_at) : new Date(0);
          bValue = b.pull_request?.merged_at ? new Date(b.pull_request.merged_at) : new Date(0);
        } else {
          aValue = a.merged_at ? new Date(a.merged_at) : new Date(0);
          bValue = b.merged_at ? new Date(b.merged_at) : new Date(0);
        }
        break;
      case 'updated':
      default:
        aValue = new Date(a.updated_at || 0);
        bValue = new Date(b.updated_at || 0);
        break;
    }
    
    if (sortOrder === 'asc') {
      return aValue > bValue ? 1 : -1;
    } else {
      return aValue < bValue ? 1 : -1;
    }
  });

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const getItemUrl = (item) => {
    if (item._source === 'github') {
      if (item.html_url) return item.html_url;
      if (item.repository_url && item.number) {
        const repoMatch = item.repository_url.match(/repos\/(.+)$/);
        if (repoMatch) {
          return `https://github.com/${repoMatch[1]}/pull/${item.number}`;
        }
      }
    } else {
      return item.web_url || '#';
    }
    return '#';
  };

  if (loading) {
    return (
      <div className="app">
        <div className="loading">Loading PRs/MRs...</div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>🔀 All Pull Requests / Merge Requests</h1>
          <p className="work-year">{dateRange.label}</p>
        </div>
        <div className="header-controls">
          <DateFilter value={dateRange} onChange={setDateRange} />
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {/* Git Stats */}
      {!statsLoading && displayStats && (
        <div className="stats-grid">
          <GitSection githubStats={displayStats.github} gitlabStats={displayStats.gitlab} compact={true} />
          {displayStats.github?.error && renderErrorSection('github', '📦', displayStats.github.error)}
          {displayStats.gitlab?.error && renderErrorSection('gitlab', '🔷', displayStats.gitlab.error)}
          
          {/* Repo Breakdown */}
          {(displayStats.github?.repoBreakdown?.length > 0 || displayStats.gitlab?.repoBreakdown?.length > 0) && (
            <div className="source-section">
              <h2>📚 Repository Breakdown</h2>
              <div className="repo-list">
                {[
                  ...(displayStats.github?.repoBreakdown || []).map(r => ({ ...r, source: 'github' })),
                  ...(displayStats.gitlab?.repoBreakdown || []).map(r => ({ ...r, source: 'gitlab' }))
                ]
                  .sort((a, b) => b.total - a.total)
                  .slice(0, 20)
                  .map((repo, index) => (
                    <div key={index} className="repo-item">
                      <div className="repo-name">
                        <span className={`source-badge source-${repo.source}`}>
                          {repo.source === 'github' ? '📦' : '🔷'}
                        </span>
                        {repo.repo}
                      </div>
                      <div className="repo-stats">
                        <span className="repo-stat">{repo.total} total</span>
                        {repo.merged > 0 && <span className="repo-stat merged">{repo.merged} merged</span>}
                        {repo.open > 0 && <span className="repo-stat open">{repo.open} open</span>}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!error && (
        <div className="issues-page">
          {/* Filters */}
          <div className="issues-filters">
            <div className="filter-group">
              <label>Status:</label>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="all">All Statuses</option>
                {statuses.map(status => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </div>
            <div className="filter-group">
              <label>Source:</label>
              <select value={filterSource} onChange={(e) => setFilterSource(e.target.value)}>
                <option value="all">All Sources</option>
                {sources.map(source => (
                  <option key={source} value={source}>{source === 'github' ? 'GitHub' : 'GitLab'}</option>
                ))}
              </select>
            </div>
            <div className="filter-group">
              <label>Repository/Project:</label>
              <select value={filterRepo} onChange={(e) => setFilterRepo(e.target.value)}>
                <option value="all">All Repositories/Projects</option>
                {repos.map(repo => (
                  <option key={repo} value={repo}>{repo}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="issues-table-container">
            <table className="issues-table">
              <thead>
                <tr>
                  <th onClick={() => handleSort('title')} className="sortable">
                    Title {sortBy === 'title' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSort('source')} className="sortable">
                    Source {sortBy === 'source' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSort('repo')} className="sortable">
                    Repository/Project {sortBy === 'repo' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSort('status')} className="sortable">
                    Status {sortBy === 'status' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSort('created')} className="sortable">
                    Created {sortBy === 'created' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSort('merged')} className="sortable">
                    Merged {sortBy === 'merged' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSort('updated')} className="sortable">
                    Updated {sortBy === 'updated' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSortedItems.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="no-data">No PRs/MRs found</td>
                  </tr>
                ) : (
                  filteredAndSortedItems.map(item => {
                    const repo = item._source === 'github'
                      ? (item.repository_url?.match(/repos\/(.+)$/)?.[1] || 'Unknown')
                      : (item.project_id?.toString() || 'Unknown');
                    const status = item._source === 'github'
                      ? (item.state === 'closed' && item.pull_request?.merged_at ? 'merged' : item.state)
                      : item.state;
                    
                    return (
                      <tr key={`${item._source}-${item.id}`}>
                        <td>
                          <a href={getItemUrl(item)} target="_blank" rel="noopener noreferrer" className="issue-link">
                            {item.title || 'Untitled'}
                          </a>
                        </td>
                        <td>
                          <span className={`source-badge source-${item._source}`}>
                            {item._source === 'github' ? 'GitHub' : 'GitLab'}
                          </span>
                        </td>
                        <td>{repo}</td>
                        <td>
                          <span className={`status-badge status-${status}`}>
                            {status}
                          </span>
                        </td>
                        <td>{item.created_at ? format(new Date(item.created_at), 'MMM dd, yyyy') : '-'}</td>
                        <td>
                          {item._source === 'github'
                            ? (item.pull_request?.merged_at ? format(new Date(item.pull_request.merged_at), 'MMM dd, yyyy') : '-')
                            : (item.merged_at ? format(new Date(item.merged_at), 'MMM dd, yyyy') : '-')
                          }
                        </td>
                        <td>{item.updated_at ? format(new Date(item.updated_at), 'MMM dd, yyyy') : '-'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default PRsPage;

