import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import axios from 'axios';
import '../styles/analytics-common.css';
import './AnalyticsLandingPage.css';

/**
 * Analytics landing page - overview of all tracked projects
 */
function AnalyticsLandingPage() {
  const location = useLocation();
  const queryString = location.search;
  
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch project list from config
    const fetchProjects = async () => {
      try {
        const response = await axios.get('/api/analytics/projects');
        setProjects(response.data.projects || []);
      } catch (err) {
        // Fallback to hardcoded projects if endpoint doesn't exist
        setProjects([
          {
            key: 'SEWEB-59645',
            label: 'DraftKings Integration',
            description: 'Bet clicks tracking across all ESPN pages with DraftKings integration.',
            launchDate: '2025-12-01',
            route: '/analytics/draftkings',
            icon: '🎰',
            metrics: ['Bet Clicks', 'Page Breakdown', 'Daily Trends']
          },
          {
            key: 'SEWEB-51747',
            label: 'Next Gen Gamecast Football',
            description: 'My Bets feature + redesign for NFL Gamecast. Shows linked bet users their placed bets.',
            launchDate: '2025-08-25',
            endDate: '2025-12-01',
            route: '/analytics/nfl-gamecast',
            icon: '🏈',
            metrics: ['Page Views', 'Bet Clicks', 'Conversion Rate']
          }
        ]);
      } finally {
        setLoading(false);
      }
    };

    fetchProjects();
  }, []);

  return (
    <div className="analytics-landing">
      <header className="page-header">
        <h1>Analytics</h1>
        <p className="subtitle">Track product impact with Adobe Analytics data</p>
      </header>

      <div className="projects-grid">
        {loading ? (
          <div className="loading-card">Loading projects...</div>
        ) : (
          projects.map(project => (
            <Link 
              key={project.key} 
              to={`${project.route}${queryString}`}
              className="project-card"
            >
              <div className="project-content">
                <h2>{project.label}</h2>
                <span className="project-key">{project.key}</span>
                <p className="project-description">{project.description}</p>
                
                <div className="project-dates">
                  <span className="date-badge">
                    Launch: {project.launchDate}
                  </span>
                  {project.endDate && (
                    <span className="date-badge ended">
                      Ended: {project.endDate}
                    </span>
                  )}
                </div>

                <div className="project-metrics">
                  {project.metrics?.map(metric => (
                    <span key={metric} className="metric-tag">{metric}</span>
                  ))}
                </div>
              </div>
              <div className="project-arrow">→</div>
            </Link>
          ))
        )}
      </div>

      <section className="quick-links">
        <h3>Quick Actions</h3>
        <div className="links-row">
          <a 
            href="https://experience.adobe.com/#/@disneyespn/analytics/spa/analysis/workspace" 
            target="_blank" 
            rel="noopener noreferrer"
            className="quick-link"
          >
            <span className="link-icon">📈</span>
            Adobe Analytics Workspace
          </a>
          <a 
            href="https://jira.disney.com/browse/SEWEB-59645" 
            target="_blank" 
            rel="noopener noreferrer"
            className="quick-link"
          >
            <span className="link-icon">🎫</span>
            DraftKings Jira Epic
          </a>
          <a 
            href="https://jira.disney.com/browse/SEWEB-51747" 
            target="_blank" 
            rel="noopener noreferrer"
            className="quick-link"
          >
            <span className="link-icon">🎫</span>
            NFL Gamecast Jira Epic
          </a>
        </div>
      </section>
    </div>
  );
}

export default AnalyticsLandingPage;

