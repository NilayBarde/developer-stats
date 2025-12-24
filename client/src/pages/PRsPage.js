import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { format } from 'date-fns';
import DateFilter from '../components/DateFilter';
import { getCurrentWorkYearStart, formatWorkYearLabel } from '../utils/dateHelpers';
import { buildApiUrl, getStatusClasses } from '../utils/apiHelpers';
import { getItemStatus, getItemRepo, getItemUrl, getMergedDate } from '../utils/prItemHelpers';
import { createFilter, createSorter, extractFilterOptions } from '../utils/filterHelpers';
import clientCache from '../utils/clientCache';
import GitSection from '../components/GitSection';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { renderErrorSection } from '../utils/sectionHelpers';
import './PRsPage.css';

function PRsPage() {
  const [prs, setPRs] = useState([]);
  const [mrs, setMRs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ status: 'all', source: 'all', repo: 'all' });
  const [sort, setSort] = useState({ by: 'updated', order: 'desc' });
  
  // Check for mock mode
  const mockParam = new URLSearchParams(window.location.search).get('mock') === 'true' ? '&mock=true' : '';
  
  const workYearStart = getCurrentWorkYearStart();
  const [dateRange, setDateRange] = useState({
    label: formatWorkYearLabel(workYearStart),
    start: workYearStart,
    end: null,
    type: 'custom'
  });

  // Fetch data
  const fetchData = useCallback(async () => {
    // Check cache first
    const cachedPRs = clientCache.get('/api/prs', dateRange);
    const cachedMRs = clientCache.get('/api/mrs', dateRange);
    
    if (cachedPRs && cachedMRs) {
      setPRs((cachedPRs.prs || []).map(pr => ({ ...pr, _source: 'github' })));
      setMRs((cachedMRs.mrs || []).map(mr => ({ ...mr, _source: 'gitlab' })));
      setLoading(false);
      setError(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      const [prsRes, mrsRes] = await Promise.all([
        axios.get(buildApiUrl('/api/prs', dateRange) + mockParam),
        axios.get(buildApiUrl('/api/mrs', dateRange) + mockParam)
      ]);
      
      const prsData = (prsRes.data.prs || []).map(pr => ({ ...pr, _source: 'github' }));
      const mrsData = (mrsRes.data.mrs || []).map(mr => ({ ...mr, _source: 'gitlab' }));
      
      setPRs(prsData);
      setMRs(mrsData);
      
      // Cache the responses
      clientCache.set('/api/prs', dateRange, prsRes.data);
      clientCache.set('/api/mrs', dateRange, mrsRes.data);
    } catch (err) {
      setError('Failed to fetch PRs/MRs. Please check your API configuration.');
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  const fetchStats = useCallback(async () => {
    // Check cache first
    const cached = clientCache.get('/api/stats/git', dateRange);
    if (cached) {
      setStats(cached);
      setStatsLoading(false);
      return;
    }

    try {
      setStatsLoading(true);
      const response = await axios.get(buildApiUrl('/api/stats/git', dateRange) + mockParam);
      setStats(response.data);
      clientCache.set('/api/stats/git', dateRange, response.data);
    } catch (err) {
      console.error('Error fetching stats:', err);
    } finally {
      setStatsLoading(false);
    }
  }, [dateRange]);

  useEffect(() => {
    fetchData();
    fetchStats();
  }, [fetchData, fetchStats]);

  // Combined items
  const allItems = useMemo(() => [...prs, ...mrs], [prs, mrs]);

  // Filter configuration (stable reference)
  const filterConfig = useMemo(() => ({
    status: getItemStatus,
    source: (item) => item._source,
    repo: getItemRepo
  }), []);

  // Sort configuration (stable reference)
  const sortConfig = useMemo(() => ({
    title: (item) => item.title || '',
    source: (item) => item._source || '',
    repo: getItemRepo,
    created: (item) => new Date(item.created_at || 0),
    merged: (item) => getMergedDate(item) ? new Date(getMergedDate(item)) : new Date(0),
    default: (item) => new Date(item.updated_at || 0)
  }), []);

  // Filter options - ensure we always have arrays and map keys correctly
  const filterOptions = useMemo(() => {
    const options = extractFilterOptions(allItems, filterConfig);
    return {
      statuses: options.status || [],
      sources: options.source || [],
      repos: options.repo || []
    };
  }, [allItems, filterConfig]);

  // Filtered and sorted items
  const filteredItems = useMemo(() => {
    const filterFn = createFilter(filters, filterConfig);
    const sortFn = createSorter(sort.by, sort.order, sortConfig);
    
    return [...allItems]
      .filter(filterFn)
      .sort(sortFn);
  }, [allItems, filters, sort, filterConfig, sortConfig]);

  // Calculate display stats
  // Use server stats when items haven't loaded yet, otherwise use filtered local stats
  const displayStats = useMemo(() => {
    if (!stats) return null;
    
    // If items haven't loaded yet, use server stats as-is
    if (loading || allItems.length === 0) {
      return stats;
    }
    
    // Otherwise, calculate from filtered local items
    const githubItems = filteredItems.filter(item => item._source === 'github');
    const gitlabItems = filteredItems.filter(item => item._source === 'gitlab');
    
    return {
      github: stats.github ? {
        ...stats.github,
        total: githubItems.length,
        merged: githubItems.filter(item => item.state === 'closed' && item.pull_request?.merged_at).length,
        open: githubItems.filter(item => item.state === 'open').length
      } : null,
      gitlab: stats.gitlab ? {
        ...stats.gitlab,
        total: gitlabItems.length,
        merged: gitlabItems.filter(item => item.state === 'merged').length,
        open: gitlabItems.filter(item => item.state === 'opened').length
      } : null
    };
  }, [stats, filteredItems, loading, allItems.length]);

  // Handlers
  const handleSort = (field) => {
    setSort(prev => ({
      by: field,
      order: prev.by === field && prev.order === 'desc' ? 'asc' : 'desc'
    }));
  };

  const updateFilter = (key, value) => setFilters(prev => ({ ...prev, [key]: value }));

  const SortIndicator = ({ field }) => sort.by === field ? (sort.order === 'asc' ? ' ↑' : ' ↓') : '';

  return (
    <div className="prs-page">
      <header className="page-header">
        <div>
          <h1>All Pull Requests / Merge Requests</h1>
          <p className="date-label">{dateRange.label}</p>
        </div>
        <div className="header-controls">
          <DateFilter value={dateRange} onChange={setDateRange} />
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {/* Stats Section */}
      {statsLoading ? (
        <LoadingSpinner text="Loading stats..." />
      ) : displayStats && (
        <div className="stats-section">
          <GitSection githubStats={displayStats.github} gitlabStats={displayStats.gitlab} compact={true} />
          {displayStats.github?.error && renderErrorSection('github', '', displayStats.github.error)}
          {displayStats.gitlab?.error && renderErrorSection('gitlab', '', displayStats.gitlab.error)}
          
          {/* Repo Breakdown */}
          {(displayStats.github?.repoBreakdown?.length > 0 || displayStats.gitlab?.repoBreakdown?.length > 0) && (
            <div className="repo-breakdown-section">
              <h2>Repository Breakdown</h2>
              <div className="repo-list">
                {[
                  ...(displayStats.github?.repoBreakdown || []).map(r => ({ ...r, source: 'github' })),
                  ...(displayStats.gitlab?.repoBreakdown || []).map(r => ({ ...r, source: 'gitlab' }))
                ].sort((a, b) => b.total - a.total).slice(0, 20).map((repo, i) => (
                  <div key={i} className="repo-item">
                    <div className="repo-name">
                      <span className={`source-tag ${repo.source}`}>
                        {repo.source === 'github' ? 'GH' : 'GL'}
                      </span>
                      {repo.repo}
                    </div>
                    <div className="repo-stats">
                      <span className="stat">{repo.total} total</span>
                      {repo.merged > 0 && <span className="stat merged">{repo.merged} merged</span>}
                      {repo.open > 0 && <span className="stat open">{repo.open} open</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Table Section */}
      {!error && (
        <div className="table-section">
          {loading ? (
            <LoadingSpinner text="Loading PRs/MRs..." />
          ) : (
            <>
              {/* Filters */}
              <div className="filters">
                <div className="filter-group">
                  <label>Status:</label>
                  <select value={filters.status} onChange={e => updateFilter('status', e.target.value)}>
                    <option value="all">All Statuses</option>
                    {filterOptions.statuses.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="filter-group">
                  <label>Source:</label>
                  <select value={filters.source} onChange={e => updateFilter('source', e.target.value)}>
                    <option value="all">All Sources</option>
                    {filterOptions.sources.map(s => <option key={s} value={s}>{s === 'github' ? 'GitHub' : 'GitLab'}</option>)}
                  </select>
                </div>
                <div className="filter-group">
                  <label>Repository:</label>
                  <select value={filters.repo} onChange={e => updateFilter('repo', e.target.value)}>
                    <option value="all">All Repositories</option>
                    {filterOptions.repos.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>

              {/* Table */}
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th onClick={() => handleSort('title')}>Title<SortIndicator field="title" /></th>
                      <th onClick={() => handleSort('source')}>Source<SortIndicator field="source" /></th>
                      <th onClick={() => handleSort('repo')}>Repository<SortIndicator field="repo" /></th>
                      <th>Status</th>
                      <th onClick={() => handleSort('created')}>Created<SortIndicator field="created" /></th>
                      <th onClick={() => handleSort('merged')}>Merged<SortIndicator field="merged" /></th>
                      <th onClick={() => handleSort('updated')}>Updated<SortIndicator field="updated" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.length === 0 ? (
                      <tr><td colSpan="7" className="empty">No PRs/MRs found</td></tr>
                    ) : (
                      filteredItems.map(item => {
                        const status = getItemStatus(item);
                        const mergedDate = getMergedDate(item);
                        return (
                          <tr key={`${item._source}-${item.id}`}>
                            <td>
                              <a href={getItemUrl(item)} target="_blank" rel="noopener noreferrer">
                                {item.title || 'Untitled'}
                              </a>
                            </td>
                            <td>
                              <span className={`source-badge ${item._source}`}>
                                {item._source === 'github' ? 'GitHub' : 'GitLab'}
                              </span>
                            </td>
                            <td>{getItemRepo(item)}</td>
                            <td>
                              <span className={`status-badge ${getStatusClasses(status)}`}>{status}</span>
                            </td>
                            <td>{item.created_at ? format(new Date(item.created_at), 'MMM dd, yyyy') : '-'}</td>
                            <td>{mergedDate ? format(new Date(mergedDate), 'MMM dd, yyyy') : '-'}</td>
                            <td>{item.updated_at ? format(new Date(item.updated_at), 'MMM dd, yyyy') : '-'}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default PRsPage;
