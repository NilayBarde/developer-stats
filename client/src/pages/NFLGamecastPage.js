import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import ProjectAnalytics from '../components/ui/ProjectAnalytics';
import '../styles/analytics-common.css';
import './NFLGamecastPage.css';

/**
 * NFL Gamecast Project Analytics Page
 * Tracks: My Bets feature + redesign (Aug 25 - Dec 1, 2025)
 */
function NFLGamecastPage() {
  const location = useLocation();
  const queryString = location.search;

  return (
    <div className="analytics-page">
      <nav className="breadcrumb">
        <Link to={`/analytics${queryString}`}>Analytics</Link>
        <span className="separator">/</span>
        <span className="current">NFL Gamecast</span>
      </nav>

      <ProjectAnalytics projectKey="SEWEB-51747" />

      <section className="about-section">
        <h3>About This Project</h3>
        <div className="info-grid">
          <div className="info-card">
            <h4>🎯 My Bets Feature</h4>
            <p>
              Users who linked their betting account with ESPN can see any bets 
              they've placed that include the current game directly on the Gamecast page.
            </p>
          </div>
          <div className="info-card">
            <h4>🎨 Page Redesign</h4>
            <p>
              Complete UI overhaul of the NFL Gamecast experience with improved 
              layout, performance, and user engagement features.
            </p>
          </div>
          <div className="info-card">
            <h4>📊 Tracking Segments</h4>
            <p>
              <strong>Coming soon:</strong> Comparison between linked bet users 
              vs non-linked users to measure feature adoption impact.
            </p>
          </div>
        </div>
      </section>

      <section className="links-section">
        <h3>Related Links</h3>
        <div className="links-row">
          <a 
            href="https://jira.disney.com/browse/SEWEB-51747" 
            target="_blank" 
            rel="noopener noreferrer"
            className="external-link"
          >
            🎫 Jira Epic
          </a>
          <a 
            href="https://www.espn.com/nfl/game/_/gameId/401671789" 
            target="_blank" 
            rel="noopener noreferrer"
            className="external-link"
          >
            🏈 Example Gamecast
          </a>
          <a 
            href="https://experience.adobe.com/#/@disneyespn/analytics/spa/analysis/workspace" 
            target="_blank" 
            rel="noopener noreferrer"
            className="external-link"
          >
            📈 Adobe Analytics
          </a>
        </div>
      </section>
    </div>
  );
}

export default NFLGamecastPage;

