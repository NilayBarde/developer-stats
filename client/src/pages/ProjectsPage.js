import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { getJiraUrl } from '../utils/urlHelpers';
import clientCache from '../utils/clientCache';
import StatsCard from '../components/StatsCard';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import './ProjectsPage.css';

function ProjectsPage() {
  const [projects, setProjects] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [baseUrl, setBaseUrl] = useState(null);
  
  // Check for mock mode
  const mockParam = new URLSearchParams(window.location.search).get('mock') === 'true' ? '?mock=true' : '';

  // Fetch all projects (no date filtering)
  const fetchProjects = useCallback(async () => {
    // Check cache first - include mock param in cache key
    const cacheKey = `/api/projects${mockParam || ''}`;
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
      const response = await axios.get('/api/projects' + mockParam);
      setProjects(response.data);
      setBaseUrl(response.data.baseUrl);
      clientCache.set(cacheKey, null, response.data);
    } catch (err) {
      setError('Failed to fetch projects. Please check your API configuration.');
      console.error('Error fetching projects:', err);
    } finally {
      setLoading(false);
    }
  }, [mockParam]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);


  return (
    <div className="projects-page">
      <header className="page-header">
        <div>
          <h1>Projects</h1>
          <p className="date-label">All time · Sorted by most recent activity</p>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <LoadingSpinner text="Loading projects..." />
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
              value={`${projects.epics.reduce((sum, epic) => sum + (epic.metrics.userTotalPointsAllTime || 0), 0) + 
                     (projects.issuesWithoutEpicList || []).reduce((sum, issue) => sum + (issue.storyPoints || 0), 0)} SP`}
              subtitle={`${projects.epics.reduce((sum, epic) => sum + (epic.metrics.userTotalIssuesAllTime || 0), 0) + (projects.issuesWithoutEpicList?.length || 0)} issues across all projects`}
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
                  <div className="project-header">
                    <div className="project-title-section">
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
                        {epic.issueTypeBreakdown && Object.keys(epic.issueTypeBreakdown).length > 0 && (
                          <span className="issue-type-breakdown">
                            {Object.entries(epic.issueTypeBreakdown)
                              .sort((a, b) => b[1] - a[1])
                              .map(([type, count]) => `${count} ${type}${count !== 1 ? 's' : ''}`)
                              .join(' · ')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Metrics */}
                  <div className="project-metrics">
                    <div className="metric-item metric-epic-total">
                      <span className="metric-label">Epic Total</span>
                      <span className="metric-value">
                        {epic.metrics.epicTotalIssues || 0} issues · {epic.metrics.epicTotalPoints || 0} SP
                      </span>
                    </div>
                    <div className="metric-item metric-contribution">
                      <span className="metric-label">My Contribution</span>
                      <span className="metric-value">
                        {epic.metrics.userTotalIssuesAllTime || 0} issues · {epic.metrics.userTotalPointsAllTime || 0} SP
                      </span>
                      <span className="metric-percentage">
                        ({epic.metrics.epicTotalPoints > 0 
                          ? Math.round(((epic.metrics.userTotalPointsAllTime || 0) / epic.metrics.epicTotalPoints) * 100) 
                          : 0}% of epic)
                      </span>
                    </div>
                    <div className="metric-item">
                      <span className="metric-label">Completed</span>
                      <span className="metric-value">
                        {epic.metrics.totalDoneIssues || 0} issues · {epic.metrics.storyPointsCompleted || 0} SP
                      </span>
                    </div>
                    <div className="metric-item">
                      <span className="metric-label">In Progress</span>
                      <span className="metric-value">
                        {(epic.metrics.totalIssues || 0) - (epic.metrics.totalDoneIssues || 0)} issues · {epic.metrics.remainingStoryPoints || 0} SP
                      </span>
                    </div>
                  </div>

                  {/* Issues List */}
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
                          <span className={`issue-status issue-status-${issue.status.toLowerCase().replace(/\s+/g, '-')}`}>
                            {issue.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Issues Without Epic Section */}
            {projects.issuesWithoutEpicList && projects.issuesWithoutEpicList.length > 0 && (
              <div className="project-card">
              <div className="project-header">
                <div className="project-title-section">
                  <h2>Issues Without Epic</h2>
                  <div className="project-meta">
                    <span className="project-key">{projects.issuesWithoutEpic} issues · {(projects.issuesWithoutEpicList || []).reduce((sum, issue) => sum + (issue.storyPoints || 0), 0)} SP</span>
                  </div>
                </div>
              </div>

              {/* Issues List */}
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
                      <span className={`issue-status issue-status-${issue.status.toLowerCase().replace(/\s+/g, '-')}`}>
                        {issue.status}
                      </span>
                    </div>
                  ))}
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

