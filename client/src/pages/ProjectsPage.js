import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { getJiraUrl } from '../utils/urlHelpers';
import clientCache from '../utils/clientCache';
import StatsCard from '../components/StatsCard';
import Skeleton from '../components/ui/Skeleton';
import DateFilter from '../components/DateFilter';
import { getCurrentWorkYearStart, formatWorkYearLabel } from '../utils/dateHelpers';
import './ProjectsPage.css';

function ProjectsPage() {
  const [projects, setProjects] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [baseUrl, setBaseUrl] = useState(null);
  const [dateRange, setDateRange] = useState(() => {
    const start = getCurrentWorkYearStart();
    return {
      label: formatWorkYearLabel(start),
      start: start,
      end: null,
      type: 'custom'
    };
  });
  
  // Check for mock mode
  const mockParam = new URLSearchParams(window.location.search).get('mock') === 'true' ? '?mock=true' : '';

  // Fetch all projects (no date filtering)
  // Fetch all projects (with date filtering)
  const fetchProjects = useCallback(async () => {
    // Check cache first - include mock param and date range in cache key
    const query = new URLSearchParams();
    if (mockParam) query.append('mock', 'true');
    if (dateRange.start) query.append('start', dateRange.start);
    if (dateRange.end) query.append('end', dateRange.end);
    
    const queryString = query.toString() ? `?${query.toString()}` : '';
    const cacheKey = `/api/projects${queryString}`;
    
    const cached = clientCache.get(cacheKey, null);
    if (cached) {
      console.log('✓ Projects served from client cache');
      setProjects(cached);
      setBaseUrl(cached.baseUrl);
      setLoading(false);
      setError(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const response = await axios.get('/api/projects' + queryString);
      setProjects(response.data);
      setBaseUrl(response.data.baseUrl);
      clientCache.set(cacheKey, null, response.data);
    } catch (err) {
      setError('Failed to fetch projects. Please check your API configuration.');
      console.error('Error fetching projects:', err);
    } finally {
      setLoading(false);
    }
  }, [mockParam, dateRange]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);


  return (
    <div className="projects-page">
      <header className="page-header">
        <div>
          <h1>Projects</h1>
          <p className="date-label">Sorted by most recent activity</p>
        </div>
        <div className="header-controls">
          <DateFilter value={dateRange} onChange={setDateRange} />
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="projects-skeleton">
          <div className="projects-summary">
            <Skeleton variant="stat-card" count={2} />
          </div>
          <div className="projects-list">
            <Skeleton variant="card" count={4} />
          </div>
        </div>
      ) : !projects || !projects.epics || projects.epics.length === 0 ? (
        <div className="no-data-message">No projects found</div>
      ) : (
        <>
          {/* Summary Stats */}
          <div className="projects-summary">
            <StatsCard
              title="Projects"
              value={projects.totalEpics}
              subtitle={`${projects.issuesWithoutEpic} issues without epic`}
              color="blue"
            />
            <StatsCard
              title="My Total Contribution"
              value={`${projects.epics.reduce((sum, epic) => sum + (epic.metrics?.userTotalPointsAllTime || 0), 0) + 
                     (projects.issuesWithoutEpicList || []).reduce((sum, issue) => sum + (issue.storyPoints || 0), 0)} SP`}
              subtitle={`${projects.epics.reduce((sum, epic) => sum + (epic.metrics?.userTotalIssuesAllTime || 0), 0) + (projects.issuesWithoutEpicList?.length || 0)} issues across all projects`}
              color="green"
            />
          </div>

          {/* Filter Info */}
          <div className="filter-info">
            <details>
              <summary>📊 How this data is filtered</summary>
              <ul>
                <li><strong>Your projects:</strong> Shows all epics/projects you've contributed to</li>
                <li><strong>Your issues only:</strong> Shows issues assigned to you within each project</li>
                <li><strong>Excludes:</strong> User Story issue types (containers, not actual work items)</li>
                <li><strong>Sorted by:</strong> Most recent activity first</li>
              </ul>
            </details>
          </div>

          {/* Projects List */}
          <div className="projects-list">
            {projects.epics.map(epic => {
              return (
                <div key={epic.epicKey} className="project-card">
                  {/* Left: Title & Meta */}
                  <div className="project-left">
                    <h2>
                      <a 
                        href={getJiraUrl(epic.epicKey, baseUrl)} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="epic-link"
                      >
                        {epic.epicName}
                      </a>
                    </h2>
                    <div className="project-meta">
                      <span className="project-key">{epic.project}</span>
                    </div>
                    {epic.issueTypeBreakdown && Object.keys(epic.issueTypeBreakdown).length > 0 && (
                      <p className="issue-type-breakdown">
                        {Object.entries(epic.issueTypeBreakdown)
                          .sort((a, b) => b[1] - a[1])
                          .map(([type, count]) => `${count} ${type}${count !== 1 ? 's' : ''}`)
                          .join(' · ')}
                      </p>
                    )}
                  </div>

                  {/* Center: Metrics */}
                  <div className="project-center">
                    <div className="project-metrics">
                      <div className="metric-item metric-epic-total">
                        <span className="metric-label">Epic Total</span>
                        <span className="metric-value">
                          {epic.metrics?.epicTotalIssues || 0} issues · {epic.metrics?.epicTotalPoints || 0} SP
                        </span>
                      </div>
                      <div className="metric-item metric-contribution">
                        <span className="metric-label">My Contribution</span>
                        <span className="metric-value">
                          {epic.metrics?.userTotalIssuesAllTime || 0} issues · {epic.metrics?.userTotalPointsAllTime || 0} SP
                        </span>
                        <span className="metric-percentage">
                          ({epic.metrics?.epicTotalPoints > 0 
                            ? Math.round(((epic.metrics?.userTotalPointsAllTime || 0) / epic.metrics?.epicTotalPoints) * 100) 
                            : 0}% of epic)
                        </span>
                      </div>
                      <div className="metric-row">
                        <div className="metric-item">
                          <span className="metric-label">Completed</span>
                          <span className="metric-value">
                            {epic.metrics?.totalDoneIssues || 0} issues · {epic.metrics?.storyPointsCompleted || 0} SP
                          </span>
                        </div>
                        <div className="metric-item">
                          <span className="metric-label">In Progress</span>
                          <span className="metric-value">
                            {(epic.metrics?.totalIssues || 0) - (epic.metrics?.totalDoneIssues || 0)} issues · {epic.metrics?.remainingStoryPoints || 0} SP
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right: Issues List */}
                  <div className="project-right">
                    <div className="project-issues">
                      <h3>My Issues</h3>
                      <div className="issues-list">
                        {epic.issues.map(issue => (
                          <div key={issue.key} className="issue-item user-issue">
                            <a
                              href={getJiraUrl(issue.key, baseUrl)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="issue-link"
                            >
                              {issue.key}
                            </a>
                            <span className="issue-summary">{issue.summary}</span>
                            <span className="issue-story-points">{issue.storyPoints > 0 ? `${issue.storyPoints} SP` : '-'}</span>
                            <span className={`issue-status issue-status-${(issue.status || '').toLowerCase().replace(/\s+/g, '-')}`}>
                              {issue.status || 'Unknown'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Issues Without Epic Section */}
            {projects.issuesWithoutEpicList && projects.issuesWithoutEpicList.length > 0 && (
              <div className="project-card">
                {/* Left: Title */}
                <div className="project-left">
                  <h2>Issues Without Epic</h2>
                  <div className="project-meta">
                    <span className="project-key">{projects.issuesWithoutEpic} issues · {(projects.issuesWithoutEpicList || []).reduce((sum, issue) => sum + (issue.storyPoints || 0), 0)} SP</span>
                  </div>
                </div>

                {/* Center: Empty for this card */}
                <div className="project-center"></div>

                {/* Right: Issues List */}
                <div className="project-right">
                  <div className="project-issues">
                    <h3>My Issues</h3>
                    <div className="issues-list">
                      {projects.issuesWithoutEpicList.map(issue => (
                        <div key={issue.key} className="issue-item user-issue">
                          <a
                            href={getJiraUrl(issue.key, baseUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="issue-link"
                          >
                            {issue.key}
                          </a>
                          <span className="issue-summary">{issue.summary}</span>
                          <span className="issue-story-points">{issue.storyPoints > 0 ? `${issue.storyPoints} SP` : '-'}</span>
                          <span className={`issue-status issue-status-${(issue.status || '').toLowerCase().replace(/\s+/g, '-')}`}>
                            {issue.status || 'Unknown'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default ProjectsPage;

