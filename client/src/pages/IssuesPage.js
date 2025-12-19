import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { format } from 'date-fns';
import DateFilter from '../components/DateFilter';
import { getCurrentWorkYearStart, formatWorkYearLabel } from '../utils/dateHelpers';
import { getJiraUrl } from '../utils/urlHelpers';
import { getStoryPoints } from '../utils/jiraHelpers';
import JiraSection from '../components/JiraSection';
import { renderErrorSection } from '../utils/sectionHelpers';
import './IssuesPage.css';

function IssuesPage() {
  const [issues, setIssues] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [baseUrl, setBaseUrl] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterProject, setFilterProject] = useState('all');
  const [filterSprint, setFilterSprint] = useState('all');
  const [sortBy, setSortBy] = useState('inProgress'); // 'updated', 'created', 'key', 'sprint', 'inProgress', 'qaReady'
  const [sortOrder, setSortOrder] = useState('desc'); // 'asc', 'desc'
  
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
    return queryString ? `/api/issues?${queryString}` : '/api/issues';
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

  const fetchIssues = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const url = buildApiUrl(dateRange);
      const response = await axios.get(url);
      setIssues(response.data.issues || []);
      setBaseUrl(response.data.baseUrl);
    } catch (err) {
      setError('Failed to fetch issues. Please check your API configuration.');
      console.error('Error fetching issues:', err);
    } finally {
      setLoading(false);
    }
  }, [dateRange, buildApiUrl]);

  const fetchStats = useCallback(async () => {
    try {
      setStatsLoading(true);
      const url = buildStatsApiUrl(dateRange);
      const response = await axios.get(url);
      setStats(response.data);
    } catch (err) {
      console.error('Error fetching stats:', err);
      // Don't set error state - stats are optional
    } finally {
      setStatsLoading(false);
    }
  }, [dateRange, buildStatsApiUrl]);

  useEffect(() => {
    fetchIssues();
    fetchStats();
  }, [fetchIssues, fetchStats]);

  // Get unique statuses, projects, and sprints for filters
  const statuses = [...new Set(issues.map(issue => issue.fields?.status?.name).filter(Boolean))].sort();
  const projects = [...new Set(issues.map(issue => issue.fields?.project?.key).filter(Boolean))].sort();
  const sprints = [...new Set(issues.map(issue => issue._sprintName).filter(Boolean))].sort();

  // Filter issues based on current filters
  const filteredIssues = issues.filter(issue => {
    if (filterStatus !== 'all' && issue.fields?.status?.name !== filterStatus) return false;
    if (filterProject !== 'all' && issue.fields?.project?.key !== filterProject) return false;
    if (filterSprint !== 'all' && issue._sprintName !== filterSprint) return false;
    return true;
  });

  // Calculate stats from filtered issues
  const calculateFilteredStats = (filteredIssues) => {
    const total = filteredIssues.length;
    const resolved = filteredIssues.filter(issue => issue.fields?.resolutiondate).length;
    const done = filteredIssues.filter(issue => 
      issue.fields?.status?.name === 'Done' || issue.fields?.status?.name === 'Closed'
    ).length;
    const inProgress = filteredIssues.filter(issue => 
      issue.fields?.status?.name !== 'Done' && issue.fields?.status?.name !== 'Closed'
    ).length;

    // Calculate average resolution time (from In Progress to QA Ready)
    const issuesWithResolutionTime = filteredIssues.filter(issue => 
      issue._inProgressDate && issue._qaReadyDate
    );
    let avgResolutionTime = 0;
    let resolutionTimeCount = 0;
    if (issuesWithResolutionTime.length > 0) {
      const resolutionTimes = issuesWithResolutionTime.map(issue => {
        const inProgressDate = new Date(issue._inProgressDate);
        const qaReadyDate = new Date(issue._qaReadyDate);
        return (qaReadyDate - inProgressDate) / (1000 * 60 * 60 * 24); // days
      }).filter(time => time > 0); // Only positive times
      
      resolutionTimeCount = resolutionTimes.length;
      if (resolutionTimes.length > 0) {
        avgResolutionTime = resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length;
      }
    }

    // Calculate average issues per month
    const issuesByMonth = {};
    filteredIssues.forEach(issue => {
      const date = issue._inProgressDate 
        ? new Date(issue._inProgressDate)
        : (issue.fields?.updated ? new Date(issue.fields.updated) : null);
      if (date && !isNaN(date.getTime())) {
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const monthKey = `${date.getFullYear()}-${month}`;
        issuesByMonth[monthKey] = (issuesByMonth[monthKey] || 0) + 1;
      }
    });
    const monthlyCounts = Object.values(issuesByMonth);
    const avgIssuesPerMonth = monthlyCounts.length > 0
      ? monthlyCounts.reduce((a, b) => a + b, 0) / monthlyCounts.length
      : 0;

    // Calculate last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const last30Days = filteredIssues.filter(issue => {
      const updatedDate = issue.fields?.updated ? new Date(issue.fields.updated) : null;
      return updatedDate && updatedDate >= thirtyDaysAgo;
    }).length;

    return {
      total,
      resolved,
      done,
      inProgress,
      avgResolutionTime: Math.round(avgResolutionTime * 10) / 10,
      avgResolutionTimeCount: resolutionTimeCount,
      avgIssuesPerMonth: Math.round(avgIssuesPerMonth * 10) / 10,
      last30Days
    };
  };

  // Calculate filtered stats
  const filteredStats = calculateFilteredStats(filteredIssues);

  // Merge filtered stats with API stats (keep velocity from API)
  const displayStats = stats?.jira ? {
    ...stats.jira,
    ...filteredStats,
    // Keep velocity from API since it's sprint-based and complex
    velocity: stats.jira.velocity,
    // Keep baseUrl from API
    baseUrl: stats.jira.baseUrl
  } : null;

  // Filter and sort issues
  const filteredAndSortedIssues = filteredIssues
    .sort((a, b) => {
      let aValue, bValue;
      
      switch (sortBy) {
        case 'key':
          aValue = a.key || '';
          bValue = b.key || '';
          break;
        case 'sprint':
          aValue = a._sprintName || '';
          bValue = b._sprintName || '';
          break;
        case 'inProgress':
          aValue = a._inProgressDate ? new Date(a._inProgressDate) : null;
          bValue = b._inProgressDate ? new Date(b._inProgressDate) : null;
          // Handle null values - put them at the end
          if (!aValue && !bValue) return 0;
          if (!aValue) return 1;
          if (!bValue) return -1;
          break;
        case 'qaReady':
          aValue = a._qaReadyDate ? new Date(a._qaReadyDate) : null;
          bValue = b._qaReadyDate ? new Date(b._qaReadyDate) : null;
          // Handle null values - put them at the end
          if (!aValue && !bValue) return 0;
          if (!aValue) return 1;
          if (!bValue) return -1;
          break;
        case 'updated':
        default:
          aValue = new Date(a.fields?.updated || 0);
          bValue = new Date(b.fields?.updated || 0);
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

  if (loading) {
    return (
      <div className="app">
        <div className="loading">Loading issues...</div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>📋 All Issues</h1>
          <p className="work-year">{dateRange.label}</p>
        </div>
        <div className="header-controls">
          <DateFilter value={dateRange} onChange={setDateRange} />
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {/* Jira Stats */}
      {!statsLoading && displayStats && (
        <div className="stats-grid">
          <JiraSection stats={displayStats} compact={true} />
          {renderErrorSection('jira', '📋', displayStats?.error)}
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
              <label>Project:</label>
              <select value={filterProject} onChange={(e) => setFilterProject(e.target.value)}>
                <option value="all">All Projects</option>
                {projects.map(project => (
                  <option key={project} value={project}>{project}</option>
                ))}
              </select>
            </div>
            <div className="filter-group">
              <label>Sprint:</label>
              <select value={filterSprint} onChange={(e) => setFilterSprint(e.target.value)}>
                <option value="all">All Sprints</option>
                {sprints.map(sprint => (
                  <option key={sprint} value={sprint}>{sprint}</option>
                ))}
              </select>
            </div>
            <div className="filter-group">
              <label>Sort by:</label>
              <select value={`${sortBy}-${sortOrder}`} onChange={(e) => {
                const [field, order] = e.target.value.split('-');
                setSortBy(field);
                setSortOrder(order);
              }}>
                <option value="inProgress-desc">In Progress Date (Newest)</option>
                <option value="inProgress-asc">In Progress Date (Oldest)</option>
                <option value="updated-desc">Last Updated (Newest)</option>
                <option value="updated-asc">Last Updated (Oldest)</option>
                <option value="sprint-asc">Sprint (A-Z)</option>
                <option value="sprint-desc">Sprint (Z-A)</option>
                <option value="qaReady-desc">QA Ready Date (Newest)</option>
                <option value="qaReady-asc">QA Ready Date (Oldest)</option>
                <option value="key-asc">Key (A-Z)</option>
                <option value="key-desc">Key (Z-A)</option>
              </select>
            </div>
            <div className="issues-count">
              Showing {filteredAndSortedIssues.length} of {issues.length} issues
            </div>
          </div>

          {/* Issues Table */}
          <div className="issues-table-container">
            <table className="issues-table">
              <thead>
                <tr>
                  <th onClick={() => handleSort('key')} className="sortable">
                    Key {sortBy === 'key' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th>Summary</th>
                  <th onClick={() => handleSort('updated')} className="sortable">
                    Status {sortBy === 'updated' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th>Type</th>
                  <th>Project</th>
                  <th onClick={() => handleSort('sprint')} className="sortable">
                    Sprint {sortBy === 'sprint' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th>Story Points</th>
                  <th onClick={() => handleSort('inProgress')} className="sortable">
                    In Progress {sortBy === 'inProgress' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSort('qaReady')} className="sortable">
                    QA Ready {sortBy === 'qaReady' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th>Resolved</th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSortedIssues.length === 0 ? (
                  <tr>
                    <td colSpan="10" className="no-issues">
                      No issues found for the selected filters.
                    </td>
                  </tr>
                ) : (
                  filteredAndSortedIssues.map(issue => {
                    const storyPoints = getStoryPoints(issue);
                    return (
                      <tr key={issue.key}>
                        <td>
                          <a 
                            href={getJiraUrl(issue.key, baseUrl)} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="issue-link"
                          >
                            {issue.key}
                          </a>
                        </td>
                        <td className="issue-summary">{issue.fields?.summary || 'No summary'}</td>
                        <td>
                          <span className={`status-badge status-${(issue.fields?.status?.name || '').toLowerCase().replace(/\s+/g, '-')}`}>
                            {issue.fields?.status?.name || 'Unknown'}
                          </span>
                        </td>
                        <td>{issue.fields?.issuetype?.name || 'N/A'}</td>
                        <td>{issue.fields?.project?.key || 'N/A'}</td>
                        <td>{issue._sprintName || '-'}</td>
                        <td>{storyPoints > 0 ? storyPoints : '-'}</td>
                        <td>{issue._inProgressDate ? format(new Date(issue._inProgressDate), 'MMM dd, yyyy') : '-'}</td>
                        <td>{issue._qaReadyDate ? format(new Date(issue._qaReadyDate), 'MMM dd, yyyy') : '-'}</td>
                        <td>{issue.fields?.resolutiondate ? format(new Date(issue.fields.resolutiondate), 'MMM dd, yyyy') : '-'}</td>
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

export default IssuesPage;

