import React from 'react';
import { format } from 'date-fns';
import './PRList.css';
import { getJiraUrl } from '../utils/urlHelpers';

function PRList({ prs, source, baseUrl, githubBaseUrl, gitlabBaseUrl }) {
  if (!prs || prs.length === 0) {
    return null;
  }

  // Limit to last 5 items
  const displayPRs = prs.slice(0, 5);

  // Handle Jira issues differently
  if (source === 'jira') {

    return (
      <div className="pr-list">
        <h3 className="pr-list-title">Recent Issues (Last 5)</h3>
        <div className="pr-list-container">
          {displayPRs.map((issue, index) => (
            <div key={issue.id || issue.key || index} className="pr-item">
              <div className="pr-item-header">
                <a 
                  href={getJiraUrl(issue.key, baseUrl)} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="pr-title-link"
                >
                  <span className="pr-title">
                    {issue.key}: {issue.fields?.summary || 'Untitled'}
                  </span>
                </a>
                <span className={`pr-status pr-status-${(issue.fields?.status?.name || '').toLowerCase().replace(/\s+/g, '-')}`}>
                  {issue.fields?.status?.name || 'Unknown'}
                </span>
              </div>
              <div className="pr-item-meta">
                <span className="pr-date">
                  Last updated {format(
                    new Date(issue.fields?.updated || issue.fields?.created),
                    'MMM dd, yyyy'
                  )}
                </span>
                {issue.fields?.resolutiondate && (
                  <span className="pr-merged">
                    Resolved {format(new Date(issue.fields.resolutiondate), 'MMM dd')}
                  </span>
                )}
                {issue.fields?.issuetype?.name && (
                  <span className="pr-type">
                    {issue.fields.issuetype.name}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Helper function to get URL for GitHub PRs
  const getGitHubPRUrl = (pr) => {
    if (pr.html_url) return pr.html_url;
    // Fallback: construct from repository_url and number
    if (pr.repository_url && pr.number) {
      const repoMatch = pr.repository_url.match(/repos\/(.+)$/);
      if (repoMatch) {
        return `https://github.com/${repoMatch[1]}/pull/${pr.number}`;
      }
    }
    return null;
  };

  // Helper function to get URL for GitLab MRs
  const getGitLabMRUrl = (mr) => {
    if (mr.web_url) return mr.web_url;
    return null;
  };

  // Determine if a PR/MR is from GitHub or GitLab
  const getPRSource = (pr) => {
    if (pr.html_url || pr.repository_url) return 'github';
    if (pr.web_url) return 'gitlab';
    return null;
  };

  return (
    <div className="pr-list">
      <h3 className="pr-list-title">
        Recent {source === 'combined' ? 'PRs/MRs' : source === 'github' ? 'Pull Requests' : 'Merge Requests'} (Last 5)
      </h3>
      <div className="pr-list-container">
        {displayPRs.map((pr, index) => {
          const prSource = source === 'combined' ? getPRSource(pr) : source;
          const url = prSource === 'github' ? getGitHubPRUrl(pr) : getGitLabMRUrl(pr);
          
          return (
            <div key={pr.id || index} className="pr-item">
              <div className="pr-item-header">
                {url ? (
                  <a 
                    href={url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="pr-title-link"
                  >
                    <span className="pr-title">
                      {pr.title || pr.source_branch || 'Untitled'}
                    </span>
                  </a>
                ) : (
                  <span className="pr-title">
                    {pr.title || pr.source_branch || 'Untitled'}
                  </span>
                )}
                <span className={`pr-status pr-status-${pr.state || pr.status}`}>
                  {pr.state || pr.status}
                </span>
                {source === 'combined' && prSource && (
                  <span className={`pr-source-badge pr-source-badge-${prSource}`}>
                    {prSource === 'github' ? 'GitHub' : 'GitLab'}
                  </span>
                )}
              </div>
            <div className="pr-item-meta">
              <span className="pr-date">
                {format(
                  new Date(pr.created_at || pr.createdAt || pr.updated_at),
                  'MMM dd, yyyy'
                )}
              </span>
              {prSource === 'github' && pr.pull_request?.merged_at && (
                <span className="pr-merged">
                  Merged {format(new Date(pr.pull_request.merged_at), 'MMM dd')}
                </span>
              )}
              {prSource === 'gitlab' && pr.merged_at && (
                <span className="pr-merged">
                  Merged {format(new Date(pr.merged_at), 'MMM dd')}
                </span>
              )}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}

export default PRList;

