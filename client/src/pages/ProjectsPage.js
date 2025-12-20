import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import DateFilter from '../components/DateFilter';
import { getCurrentWorkYearStart, formatWorkYearLabel } from '../utils/dateHelpers';
import { buildApiUrl } from '../utils/apiHelpers';
import { getJiraUrl } from '../utils/urlHelpers';
import clientCache from '../utils/clientCache';
import StatsCard from '../components/StatsCard';
import './ProjectsPage.css';

function ProjectsPage() {
  const [projects, setProjects] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [baseUrl, setBaseUrl] = useState(null);
  
  const workYearStart = getCurrentWorkYearStart();
  const [dateRange, setDateRange] = useState({
    label: formatWorkYearLabel(workYearStart),
    start: workYearStart,
    end: null,
    type: 'custom'
  });

  // Fetch projects
  const fetchProjects = useCallback(async () => {
    // Check cache first
    const cached = clientCache.get('/api/projects', dateRange);
    if (cached) {
      setProjects(cached);
      setBaseUrl(cached.baseUrl);
      setLoading(false);
      setError(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const response = await axios.get(buildApiUrl('/api/projects', dateRange));
      setProjects(response.data);
      setBaseUrl(response.data.baseUrl);
      clientCache.set('/api/projects', dateRange, response.data);
    } catch (err) {
      setError('Failed to fetch projects. Please check your API configuration.');
      console.error('Error fetching projects:', err);
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);


  return (
    <div className="projects-page">
      <header className="page-header">
        <div>
          <h1>Projects</h1>
          <p className="date-label">{dateRange.label}</p>
        </div>
        <div className="header-controls">
          <DateFilter value={dateRange} onChange={setDateRange} />
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="loading-section">
          <div className="loading-spinner"></div>
          <p>Loading projects...</p>
        </div>
      ) : !projects || !projects.epics || projects.epics.length === 0 ? (
        <div className="no-data-message">No projects found</div>
      ) : (
        <>
          {/* Summary Stats */}
          <div className="projects-summary">
            <StatsCard
              title="Total Projects"
              value={projects.totalEpics}
              subtitle={`${projects.issuesWithoutEpic} issues without epic`}
              color="blue"
            />
            <StatsCard
              title="Total Story Points"
              value={projects.epics.reduce((sum, epic) => sum + (epic.metrics.totalAssignedStoryPoints || 0), 0)}
              subtitle={`${projects.epics.reduce((sum, epic) => sum + epic.metrics.userStoryPoints, 0)} by you`}
              color="green"
            />
            <StatsCard
              title="Avg Completion"
              value={`${Math.round(projects.epics.reduce((sum, epic) => sum + epic.metrics.totalCompletionPercentage, 0) / projects.epics.length)}%`}
              subtitle="Average across all projects"
              color="purple"
            />
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
                      </div>
                    </div>
                  </div>

                  {/* Metrics */}
                  <div className="project-metrics">
                    <div className="metric-item">
                      <span className="metric-label">Story Points:</span>
                      <span className="metric-value">
                        {epic.metrics.userStoryPoints} / {epic.metrics.totalAssignedStoryPoints}
                      </span>
                      <span className="metric-percentage">
                        ({epic.metrics.userStoryPointsPercentage}% yours)
                      </span>
                    </div>
                    <div className="metric-item">
                      <span className="metric-label">Remaining Story Points:</span>
                      <span className="metric-value">
                        {epic.metrics.remainingStoryPoints}
                      </span>
                      <span className="metric-percentage">
                        (not completed)
                      </span>
                    </div>
                    <div className="metric-item">
                      <span className="metric-label">Issues Completed:</span>
                      <span className="metric-value">
                        {epic.metrics.userDoneIssues} / {epic.metrics.totalIssues}
                      </span>
                      <span className="metric-percentage">
                        ({epic.metrics.totalCompletionPercentage}% total completion)
                      </span>
                    </div>
                  </div>

                  {/* Issues List */}
                  <div className="project-issues">
                    <h3>Your Issues ({epic.metrics.userIssues} of {epic.metrics.totalIssues} total)</h3>
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
          </div>
        </>
      )}
    </div>
  );
}

export default ProjectsPage;

