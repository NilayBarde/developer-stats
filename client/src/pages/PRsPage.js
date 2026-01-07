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
import ChartWithFallback from '../components/ChartWithFallback';
import Skeleton from '../components/ui/Skeleton';
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
  
  // Check for mock mode - memoize to avoid unnecessary re-renders
  const mockParam = useMemo(() => {
    return new URLSearchParams(window.location.search).get('mock') === 'true' ? '&mock=true' : '';
  }, []);
  
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
  }, [dateRange, mockParam]);

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
  }, [dateRange, mockParam]);

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
        // Use server's merged count (already filtered by date range), don't recalculate from filtered items
        merged: stats.github.merged || 0,
        open: githubItems.filter(item => item.state === 'open').length
      } : null,
      gitlab: stats.gitlab ? {
        ...stats.gitlab,
        total: gitlabItems.length,
        // Use server's merged count (already filtered by date range), don't recalculate from filtered items
        merged: stats.gitlab.merged || 0,
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
        <div className="stats-section">
          <div className="source-section">
            <Skeleton variant="text" width="200px" height="28px" />
            <div className="cards-grid" style={{ marginTop: '20px' }}>
              <Skeleton variant="stat-card" count={4} />
            </div>
          </div>
        </div>
      ) : displayStats && (
        <div className="stats-section">
          <GitSection githubStats={displayStats.github} gitlabStats={displayStats.gitlab} reviewStats={stats?.reviewStats} dateRange={dateRange} compact={true} />
          {displayStats.github?.error && renderErrorSection('github', '', displayStats.github.error)}
          {displayStats.gitlab?.error && renderErrorSection('gitlab', '', displayStats.gitlab.error)}
          
          {/* Repo Breakdown - Authored */}
          {(displayStats.github?.repoBreakdown?.length > 0 || displayStats.gitlab?.repoBreakdown?.length > 0) && (
            <div className="repo-breakdown-section">
              <h2>Repository Breakdown (Authored)</h2>
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
          
          {/* Merged per Month Chart */}
          {(displayStats?.github?.monthlyMerged || displayStats?.gitlab?.monthlyMerged) && (() => {
            const githubMonthly = displayStats?.github?.monthlyMerged || [];
            const gitlabMonthly = displayStats?.gitlab?.monthlyMerged || [];
            
            // Combine monthly data
            const combined = {};
            [...githubMonthly, ...gitlabMonthly].forEach(item => {
              combined[item.month] = (combined[item.month] || 0) + item.count;
            });
            
            // Filter to date range
            const startMonth = dateRange?.start?.substring(0, 7);
            const endMonth = dateRange?.end?.substring(0, 7);
            
            const monthlyData = Object.entries(combined)
              .filter(([month]) => {
                if (startMonth && month < startMonth) return false;
                if (endMonth && month > endMonth) return false;
                return true;
              })
              .map(([month, count]) => ({ month, count }))
              .sort((a, b) => a.month.localeCompare(b.month));
            
            return monthlyData.length > 0 ? (
              <ChartWithFallback
                data={monthlyData}
                title="PRs/MRs Merged per Month"
                emptyMessage="No merged data available"
              />
            ) : null;
          })()}
          
          {/* Review Comments Chart */}
          {(stats?.reviewStats?.github?.monthlyComments || stats?.reviewStats?.gitlab?.monthlyComments) && (() => {
            const githubMonthly = stats?.reviewStats?.github?.monthlyComments || {};
            const gitlabMonthly = stats?.reviewStats?.gitlab?.monthlyComments || {};
            const allMonths = new Set([...Object.keys(githubMonthly), ...Object.keys(gitlabMonthly)]);
            
            // Filter to only show months within the selected date range
            const startMonth = dateRange?.start?.substring(0, 7);
            const endMonth = dateRange?.end?.substring(0, 7);
            
            const monthlyData = Array.from(allMonths)
              .filter(month => {
                if (startMonth && month < startMonth) return false;
                if (endMonth && month > endMonth) return false;
                return true;
              })
              .map(month => ({
                month,
                count: (githubMonthly[month] || 0) + (gitlabMonthly[month] || 0)
              }))
              .sort((a, b) => a.month.localeCompare(b.month));
            
            return monthlyData.length > 0 ? (
              <ChartWithFallback
                data={monthlyData}
                title="MR/PR Comments per Month"
                emptyMessage="No comment data available"
              />
            ) : null;
          })()}
          
          {/* Repo Breakdown - Reviews */}
          {(stats?.reviewStats?.github?.byRepo?.length > 0 || stats?.reviewStats?.gitlab?.byRepo?.length > 0) && (
            <div className="repo-breakdown-section">
              <h2>Repository Breakdown (Comments)</h2>
              <div className="repo-list">
                {[
                  ...(stats?.reviewStats?.github?.byRepo || []).map(r => ({ ...r, source: 'github' })),
                  ...(stats?.reviewStats?.gitlab?.byRepo || []).map(r => ({ ...r, source: 'gitlab' }))
                ].sort((a, b) => b.comments - a.comments).slice(0, 20).map((repo, i) => (
                  <div key={i} className="repo-item">
                    <div className="repo-name">
                      <span className={`source-tag ${repo.source}`}>
                        {repo.source === 'github' ? 'GH' : 'GL'}
                      </span>
                      {repo.repo}
                    </div>
                    <div className="repo-stats">
                      <span className="stat">{repo.prsReviewed || repo.mrsReviewed || 0} MRs reviewed</span>
                      <span className="stat">{repo.comments} comments</span>
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
            <div className="skeleton-table-wrapper">
              <Skeleton variant="table-row" count={12} />
            </div>
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
