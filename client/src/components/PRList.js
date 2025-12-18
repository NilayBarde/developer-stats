import React from 'react';
import { format } from 'date-fns';
import './PRList.css';

function PRList({ prs, source }) {
  if (!prs || prs.length === 0) {
    return null;
  }

  // Limit to last 5 items
  const displayPRs = prs.slice(0, 5);

  return (
    <div className="pr-list">
      <h3 className="pr-list-title">Recent {source === 'github' ? 'Pull Requests' : 'Merge Requests'} (Last 5)</h3>
      <div className="pr-list-container">
        {displayPRs.map((pr, index) => (
          <div key={pr.id || index} className="pr-item">
            <div className="pr-item-header">
              <span className="pr-title">
                {pr.title || pr.source_branch || 'Untitled'}
              </span>
              <span className={`pr-status pr-status-${pr.state || pr.status}`}>
                {pr.state || pr.status}
              </span>
            </div>
            <div className="pr-item-meta">
              <span className="pr-date">
                {format(
                  new Date(pr.created_at || pr.createdAt),
                  'MMM dd, yyyy'
                )}
              </span>
              {source === 'github' && pr.pull_request?.merged_at && (
                <span className="pr-merged">
                  Merged {format(new Date(pr.pull_request.merged_at), 'MMM dd')}
                </span>
              )}
              {source === 'gitlab' && pr.merged_at && (
                <span className="pr-merged">
                  Merged {format(new Date(pr.merged_at), 'MMM dd')}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default PRList;

