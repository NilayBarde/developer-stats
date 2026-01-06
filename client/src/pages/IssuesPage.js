import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { format } from 'date-fns';
import DateFilter from '../components/DateFilter';
import { getCurrentWorkYearStart, formatWorkYearLabel } from '../utils/dateHelpers';
import { buildApiUrl, getStatusClasses } from '../utils/apiHelpers';
import { getJiraUrl } from '../utils/urlHelpers';
import { getStoryPoints } from '../utils/jiraHelpers';
import { createFilter, createSorter, extractFilterOptions } from '../utils/filterHelpers';
import clientCache from '../utils/clientCache';
import JiraSection from '../components/JiraSection';
import Skeleton from '../components/ui/Skeleton';
import { renderErrorSection } from '../utils/sectionHelpers';
import './IssuesPage.css';

function IssuesPage() {
  const [issues, setIssues] = useState([]);
  const [stats, setStats] = useState(null);
  const [ctoiStats, setCtoiStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [ctoiLoading, setCtoiLoading] = useState(true);
  const [error, setError] = useState(null);
  const [baseUrl, setBaseUrl] = useState(null);
  const [filters, setFilters] = useState({ status: 'all', project: 'all', sprint: 'all' });
  const [sort, setSort] = useState({ by: 'inProgress', order: 'desc' });
  
  // Check for mock mode
  const mockParam = new URLSearchParams(window.location.search).get('mock') === 'true' ? '&mock=true' : '';
  
  const workYearStart = getCurrentWorkYearStart();
  const [dateRange, setDateRange] = useState({
    label: formatWorkYearLabel(workYearStart),
    start: workYearStart,
    end: null,
    type: 'custom'
  });

  // Fetch issues
  const fetchIssues = useCallback(async () => {
    // Check cache first
    const cached = clientCache.get('/api/issues', dateRange);
    if (cached) {
      setIssues(cached.issues || []);
      setBaseUrl(cached.baseUrl);
      setLoading(false);
      setError(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const response = await axios.get(buildApiUrl('/api/issues', dateRange) + mockParam);
      const data = {
        issues: response.data.issues || [],
        baseUrl: response.data.baseUrl
      };
      setIssues(data.issues);
      setBaseUrl(data.baseUrl);
      clientCache.set('/api/issues', dateRange, data);
    } catch (err) {
      setError('Failed to fetch issues. Please check your API configuration.');
      console.error('Error fetching issues:', err);
    } finally {
      setLoading(false);
    }
  }, [dateRange, mockParam]);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    // Check cache first
    const cached = clientCache.get('/api/stats/jira', dateRange);
    if (cached) {
      setStats(cached);
      setStatsLoading(false);
      return;
    }

    try {
      setStatsLoading(true);
      const response = await axios.get(buildApiUrl('/api/stats/jira', dateRange) + mockParam);
      setStats(response.data);
      clientCache.set('/api/stats/jira', dateRange, response.data);
    } catch (err) {
      console.error('Error fetching stats:', err);
    } finally {
      setStatsLoading(false);
    }
  }, [dateRange, mockParam]);

  // Fetch CTOI stats
  const fetchCtoiStats = useCallback(async () => {
    // Check cache first
    const cached = clientCache.get('/api/stats/ctoi', dateRange);
    if (cached) {
      setCtoiStats(cached);
      setCtoiLoading(false);
      return;
    }

    try {
      setCtoiLoading(true);
      const response = await axios.get(buildApiUrl('/api/stats/ctoi', dateRange) + mockParam);
      setCtoiStats(response.data);
      clientCache.set('/api/stats/ctoi', dateRange, response.data);
    } catch (err) {
      console.error('Error fetching CTOI stats:', err);
      // CTOI is optional
    } finally {
      setCtoiLoading(false);
    }
  }, [dateRange, mockParam]);

  useEffect(() => {
    fetchIssues();
    fetchStats();
    fetchCtoiStats();
  }, [fetchIssues, fetchStats, fetchCtoiStats]);

  // Filter configuration (stable reference)
  const filterConfig = useMemo(() => ({
    status: (issue) => issue.fields?.status?.name,
    project: (issue) => issue.fields?.project?.key,
    sprint: (issue) => issue._sprintName
  }), []);

  // Sort configuration (stable reference)
  const sortConfig = useMemo(() => ({
    key: (issue) => issue.key || '',
    sprint: (issue) => issue._sprintName || '',
    inProgress: (issue) => issue._inProgressDate ? new Date(issue._inProgressDate) : null,
    qaReady: (issue) => issue._qaReadyDate ? new Date(issue._qaReadyDate) : null,
    default: (issue) => new Date(issue.fields?.updated || 0)
  }), []);

  // Filter options - ensure we always have arrays
  const filterOptions = useMemo(() => {
    const options = extractFilterOptions(issues, filterConfig);
    return {
      statuses: options.status || [],
      projects: options.project || [],
      sprints: options.sprint || []
    };
  }, [issues, filterConfig]);

  // Filtered and sorted issues
  const filteredIssues = useMemo(() => {
    const filterFn = createFilter(filters, filterConfig);
    const sortFn = createSorter(sort.by, sort.order, sortConfig);
    
    return [...issues]
      .filter(filterFn)
      .sort(sortFn);
  }, [issues, filters, sort, filterConfig, sortConfig]);

  // Calculate display stats
  // Use server stats when issues haven't loaded yet, otherwise use filtered local stats
  const displayStats = useMemo(() => {
    if (!stats) return null;
    
    // If issues haven't loaded yet, use server stats as-is
    if (loading || issues.length === 0) {
      return stats;
    }
    
    // Otherwise, calculate from filtered local issues
    const total = filteredIssues.length;
    const resolved = filteredIssues.filter(i => i.fields?.resolutiondate).length;
    const done = filteredIssues.filter(i => ['Done', 'Closed'].includes(i.fields?.status?.name)).length;
    const inProgress = filteredIssues.filter(i => !['Done', 'Closed'].includes(i.fields?.status?.name)).length;
    
    // Calculate total story points
    const totalStoryPoints = filteredIssues.reduce((sum, issue) => {
      const points = getStoryPoints(issue);
      return sum + (points || 0);
    }, 0);

    // Calculate avg resolution time
    const issuesWithTime = filteredIssues.filter(i => i._inProgressDate && i._qaReadyDate);
    let avgResolutionTime = stats.avgResolutionTime || 0;
    if (issuesWithTime.length > 0) {
      const times = issuesWithTime.map(i => {
        const start = new Date(i._inProgressDate);
        const end = new Date(i._qaReadyDate);
        return (end - start) / (1000 * 60 * 60 * 24);
      }).filter(t => t > 0);
      avgResolutionTime = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;
    }

    return {
      ...stats,
      total,
      resolved,
      done,
      inProgress,
      totalStoryPoints,
      avgResolutionTime: Math.round(avgResolutionTime * 10) / 10,
      avgResolutionTimeCount: issuesWithTime.length
    };
  }, [stats, filteredIssues, loading, issues.length]);

  // Handlers
  const handleSort = (field) => {
    setSort(prev => ({
      by: field,
      order: prev.by === field && prev.order === 'desc' ? 'asc' : 'desc'
    }));
  };

  const updateFilter = (key, value) => setFilters(prev => ({ ...prev, [key]: value }));

  const SortIndicator = ({ field }) => sort.by === field ? (sort.order === 'asc' ? ' ↑' : ' ↓') : '';

  const formatDate = (dateStr) => dateStr ? format(new Date(dateStr), 'MMM dd, yyyy') : '-';

  return (
    <div className="issues-page">
      <header className="page-header">
        <div>
          <h1>All Issues</h1>
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
            <Skeleton variant="text" width="100px" height="28px" />
            <div className="cards-grid" style={{ marginTop: '20px' }}>
              <Skeleton variant="stat-card" count={4} />
            </div>
          </div>
        </div>
      ) : displayStats && (
        <div className="stats-section">
          <JiraSection stats={displayStats} ctoiStats={ctoiLoading ? null : ctoiStats} compact={true} />
          {renderErrorSection('jira', '', displayStats?.error)}
        </div>
      )}

      {/* Filter Info */}
      <div className="filter-info">
        <details>
          <summary>📊 How this data is filtered</summary>
          <ul>
            <li><strong>Your issues only:</strong> Shows issues assigned to you</li>
            <li><strong>Date range:</strong> Issues that went "In Progress" within the selected date range</li>
            <li><strong>Excludes:</strong> Closed unassigned tickets (cancelled/no work needed)</li>
            <li><strong>Excludes:</strong> User Story issue types (containers, not actual work items)</li>
            <li><strong>Resolution time:</strong> Measures time from "In Progress" to "Ready for QA Release"</li>
          </ul>
        </details>
      </div>

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
                  <label>Project:</label>
                  <select value={filters.project} onChange={e => updateFilter('project', e.target.value)}>
                    <option value="all">All Projects</option>
                    {filterOptions.projects.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="filter-group">
                  <label>Sprint:</label>
                  <select value={filters.sprint} onChange={e => updateFilter('sprint', e.target.value)}>
                    <option value="all">All Sprints</option>
                    {filterOptions.sprints.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="filter-group">
                  <label>Sort by:</label>
                  <select 
                    value={`${sort.by}-${sort.order}`} 
                    onChange={e => {
                      const [field, order] = e.target.value.split('-');
                      setSort({ by: field, order });
                    }}
                  >
                    <option value="inProgress-desc">In Progress (Newest)</option>
                    <option value="inProgress-asc">In Progress (Oldest)</option>
                    <option value="updated-desc">Updated (Newest)</option>
                    <option value="updated-asc">Updated (Oldest)</option>
                    <option value="sprint-asc">Sprint (A-Z)</option>
                    <option value="sprint-desc">Sprint (Z-A)</option>
                    <option value="qaReady-desc">QA Ready (Newest)</option>
                    <option value="qaReady-asc">QA Ready (Oldest)</option>
                  </select>
                </div>
                <div className="filter-count">
                  Showing {filteredIssues.length} of {issues.length} issues
                </div>
              </div>

              {/* Table */}
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th onClick={() => handleSort('key')}>Key<SortIndicator field="key" /></th>
                      <th>Summary</th>
                      <th onClick={() => handleSort('updated')}>Status<SortIndicator field="updated" /></th>
                      <th>Type</th>
                      <th>Project</th>
                      <th onClick={() => handleSort('sprint')}>Sprint<SortIndicator field="sprint" /></th>
                      <th>Points</th>
                      <th onClick={() => handleSort('inProgress')}>In Progress<SortIndicator field="inProgress" /></th>
                      <th onClick={() => handleSort('qaReady')}>QA Ready<SortIndicator field="qaReady" /></th>
                      <th>Resolved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredIssues.length === 0 ? (
                      <tr><td colSpan="10" className="empty">No issues found</td></tr>
                    ) : (
                      filteredIssues.map(issue => {
                        const statusName = (issue.fields?.status?.name || '').toLowerCase().replace(/\s+/g, '-');
                        const points = getStoryPoints(issue);
                        return (
                          <tr key={issue.key}>
                            <td>
                              <a href={getJiraUrl(issue.key, baseUrl)} target="_blank" rel="noopener noreferrer">
                                {issue.key}
                              </a>
                            </td>
                            <td className="summary">{issue.fields?.summary || 'No summary'}</td>
                            <td>
                              <span className={`status-badge ${getStatusClasses(statusName)}`}>
                                {issue.fields?.status?.name || 'Unknown'}
                              </span>
                            </td>
                            <td>{issue.fields?.issuetype?.name || 'N/A'}</td>
                            <td>{issue.fields?.project?.key || 'N/A'}</td>
                            <td>{issue._sprintName || '-'}</td>
                            <td>{points > 0 ? points : '-'}</td>
                            <td>{formatDate(issue._inProgressDate)}</td>
                            <td>{formatDate(issue._qaReadyDate)}</td>
                            <td>{formatDate(issue.fields?.resolutiondate)}</td>
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

export default IssuesPage;
