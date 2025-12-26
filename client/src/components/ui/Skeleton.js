import React from 'react';
import './Skeleton.css';

/**
 * Reusable skeleton loader component
 * 
 * @param {string} variant - 'text', 'card', 'chart', 'list-item', 'stat-card'
 * @param {number} count - Number of skeleton items to render
 * @param {string} width - Custom width (e.g., '100%', '200px')
 * @param {string} height - Custom height (e.g., '20px', '100px')
 */
function Skeleton({ variant = 'text', count = 1, width, height, className = '' }) {
  const items = Array.from({ length: count }, (_, i) => i);

  const renderSkeleton = (key) => {
    switch (variant) {
      case 'stat-card':
        return (
          <div key={key} className="skeleton-stat-card">
            <div className="skeleton skeleton-text" style={{ width: '60%', height: '14px' }} />
            <div className="skeleton skeleton-text" style={{ width: '40%', height: '36px', marginTop: '12px' }} />
            <div className="skeleton skeleton-text" style={{ width: '80%', height: '12px', marginTop: '8px' }} />
          </div>
        );

      case 'card':
        return (
          <div key={key} className="skeleton-card">
            <div className="skeleton skeleton-text" style={{ width: '70%', height: '20px' }} />
            <div className="skeleton skeleton-text" style={{ width: '100%', height: '16px', marginTop: '12px' }} />
            <div className="skeleton skeleton-text" style={{ width: '90%', height: '16px', marginTop: '8px' }} />
          </div>
        );

      case 'chart':
        return (
          <div key={key} className="skeleton-chart">
            <div className="skeleton skeleton-text" style={{ width: '30%', height: '20px', marginBottom: '16px' }} />
            <div className="skeleton-chart-bars">
              {[65, 80, 45, 90, 55, 75, 60, 85, 50, 70, 40, 95].map((h, i) => (
                <div key={i} className="skeleton skeleton-bar" style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
        );

      case 'list-item':
        return (
          <div key={key} className="skeleton-list-item">
            <div className="skeleton skeleton-avatar" />
            <div className="skeleton-list-content">
              <div className="skeleton skeleton-text" style={{ width: '60%', height: '16px' }} />
              <div className="skeleton skeleton-text" style={{ width: '40%', height: '12px', marginTop: '8px' }} />
            </div>
          </div>
        );

      case 'table-row':
        return (
          <div key={key} className="skeleton-table-row">
            <div className="skeleton skeleton-text" style={{ width: '15%' }} />
            <div className="skeleton skeleton-text" style={{ width: '35%' }} />
            <div className="skeleton skeleton-text" style={{ width: '20%' }} />
            <div className="skeleton skeleton-text" style={{ width: '15%' }} />
          </div>
        );

      case 'section':
        return (
          <div key={key} className="skeleton-section">
            <div className="skeleton skeleton-text" style={{ width: '200px', height: '28px', marginBottom: '20px' }} />
            <div className="skeleton-cards-grid">
              <Skeleton variant="stat-card" />
              <Skeleton variant="stat-card" />
              <Skeleton variant="stat-card" />
              <Skeleton variant="stat-card" />
            </div>
          </div>
        );

      case 'text':
      default:
        return (
          <div
            key={key}
            className={`skeleton skeleton-text ${className}`}
            style={{ width: width || '100%', height: height || '16px' }}
          />
        );
    }
  };

  return (
    <>
      {items.map((_, i) => renderSkeleton(i))}
    </>
  );
}

/**
 * Pre-built skeleton layouts for common page sections
 */
export function DashboardSkeleton() {
  return (
    <div className="skeleton-dashboard">
      <div className="skeleton-section source-section">
        <div className="skeleton skeleton-text" style={{ width: '200px', height: '28px', marginBottom: '20px' }} />
        <div className="cards-grid">
          <Skeleton variant="stat-card" count={3} />
        </div>
      </div>
      <div className="skeleton-section source-section">
        <div className="skeleton skeleton-text" style={{ width: '100px', height: '28px', marginBottom: '20px' }} />
        <div className="cards-grid">
          <Skeleton variant="stat-card" count={4} />
        </div>
      </div>
      <div className="skeleton-section source-section">
        <div className="skeleton skeleton-text" style={{ width: '250px', height: '28px', marginBottom: '20px' }} />
        <div className="cards-grid">
          <Skeleton variant="stat-card" count={4} />
        </div>
      </div>
    </div>
  );
}

export function IssuesPageSkeleton() {
  return (
    <div className="skeleton-issues-page">
      <div className="skeleton-header">
        <div className="skeleton skeleton-text" style={{ width: '150px', height: '32px' }} />
        <div className="skeleton skeleton-text" style={{ width: '200px', height: '20px', marginTop: '8px' }} />
      </div>
      <div className="skeleton-filters">
        <Skeleton variant="text" width="120px" height="36px" />
        <Skeleton variant="text" width="120px" height="36px" />
        <Skeleton variant="text" width="120px" height="36px" />
      </div>
      <div className="skeleton-table">
        <Skeleton variant="table-row" count={10} />
      </div>
    </div>
  );
}

export function PRsPageSkeleton() {
  return (
    <div className="skeleton-prs-page">
      <div className="skeleton-header">
        <div className="skeleton skeleton-text" style={{ width: '180px', height: '32px' }} />
        <div className="skeleton skeleton-text" style={{ width: '220px', height: '20px', marginTop: '8px' }} />
      </div>
      <Skeleton variant="list-item" count={8} />
    </div>
  );
}

export function ProjectsPageSkeleton() {
  return (
    <div className="skeleton-projects-page">
      <div className="skeleton-header">
        <div className="skeleton skeleton-text" style={{ width: '120px', height: '32px' }} />
      </div>
      <div className="skeleton-projects-grid">
        <Skeleton variant="card" count={6} />
      </div>
    </div>
  );
}

export function AnalyticsPageSkeleton() {
  return (
    <div className="skeleton-analytics-page">
      <div className="skeleton-header">
        <div className="skeleton skeleton-text" style={{ width: '200px', height: '32px' }} />
        <div className="skeleton skeleton-text" style={{ width: '180px', height: '20px', marginTop: '8px' }} />
      </div>
      <Skeleton variant="chart" />
      <div className="skeleton-stats-row">
        <Skeleton variant="stat-card" count={4} />
      </div>
    </div>
  );
}

export default Skeleton;

