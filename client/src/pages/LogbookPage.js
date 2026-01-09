import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { format } from 'date-fns';
import DateFilter from '../components/DateFilter';
import { getCurrentWorkYearStart, formatWorkYearLabel } from '../utils/dateHelpers';
import { buildApiUrl } from '../utils/apiHelpers';
import clientCache from '../utils/clientCache';
import Skeleton from '../components/ui/Skeleton';
import './LogbookPage.css';

const SOURCE_JIRA = 'jira';
const SOURCE_GITHUB = 'github';
const SOURCE_GITLAB = 'gitlab';

function LogbookPage() {
  const [logbookData, setLogbookData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedMonths, setExpandedMonths] = useState(new Set());
  const [expandedDescriptions, setExpandedDescriptions] = useState(new Set());
  
  const mockParam = useMemo(() => {
    return new URLSearchParams(window.location.search).get('mock') === 'true' ? '&mock=true' : '';
  }, []);
  
  const workYearStart = getCurrentWorkYearStart();
  const [dateRange, setDateRange] = useState({
    label: formatWorkYearLabel(workYearStart),
    start: workYearStart,
    end: null,
    type: 'custom'
  });

  const fetchLogbookData = useCallback(async () => {
    const cached = clientCache.get('/api/logbook', dateRange);
    if (cached) {
      setLogbookData(cached);
      setLoading(false);
      // Expand the most recent month by default
      if (cached.months?.length > 0) {
        setExpandedMonths(new Set([cached.months[0].month]));
      }
      setError(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const response = await axios.get(buildApiUrl('/api/logbook', dateRange) + mockParam);
      setLogbookData(response.data);
      clientCache.set('/api/logbook', dateRange, response.data);
      // Expand the most recent month by default
      if (response.data.months?.length > 0) {
        setExpandedMonths(new Set([response.data.months[0].month]));
      }
    } catch (err) {
      setError('Failed to fetch logbook data. Please check your API configuration.');
      console.error('Error fetching logbook:', err);
    } finally {
      setLoading(false);
    }
  }, [dateRange, mockParam]);

  useEffect(() => {
    fetchLogbookData();
  }, [fetchLogbookData]);

  const toggleMonth = useCallback((monthKey) => {
    setExpandedMonths(prev => {
      const next = new Set(prev);
      if (next.has(monthKey)) {
        next.delete(monthKey);
      } else {
        next.add(monthKey);
      }
      return next;
    });
  }, []);

  const toggleDescription = useCallback((itemKey) => {
    setExpandedDescriptions(prev => {
      const next = new Set(prev);
      if (next.has(itemKey)) {
        next.delete(itemKey);
      } else {
        next.add(itemKey);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    if (logbookData?.months) {
      setExpandedMonths(new Set(logbookData.months.map(m => m.month)));
    }
  }, [logbookData]);

  const collapseAll = useCallback(() => {
    setExpandedMonths(new Set());
  }, []);

  const getJiraUrl = useCallback((key) => {
    const baseUrl = logbookData?.baseUrls?.jira;
    return baseUrl ? `${baseUrl}/browse/${key}` : `#${key}`;
  }, [logbookData]);

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    try {
      return format(new Date(dateStr), 'MMM d');
    } catch {
      return '';
    }
  };

  const truncateDescription = (desc, maxLength = 200) => {
    if (!desc) return '';
    // Strip Jira markup and HTML
    const cleaned = desc
      .replace(/\{[^}]+\}/g, '') // Remove {code}, {noformat}, etc.
      .replace(/\[[^\]|]+\|[^\]]+\]/g, '') // Remove [link text|url]
      .replace(/\[[^\]]+\]/g, '') // Remove [link text]
      .replace(/h[1-6]\.\s*/g, '') // Remove h1. h2. etc.
      .replace(/\*([^*]+)\*/g, '$1') // Remove bold
      .replace(/_([^_]+)_/g, '$1') // Remove italic
      .replace(/\n+/g, ' ') // Replace newlines with spaces
      .trim();
    
    if (cleaned.length <= maxLength) return cleaned;
    return cleaned.substring(0, maxLength) + '...';
  };

  const renderMetricsBadge = (label, value, className = '') => (
    <div className={`metric-badge ${className}`}>
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  );

  const renderJiraItem = (item) => {
    const itemKey = `jira-${item.key}`;
    const isExpanded = expandedDescriptions.has(itemKey);
    const hasDescription = item.description && item.description.trim().length > 0;
    
    return (
      <div key={item.key} className="logbook-item jira-item">
        <div className="item-header">
          <div className="item-meta">
            <span className={`item-type type-${item.type?.toLowerCase().replace(/\s+/g, '-')}`}>
              {item.type}
            </span>
            {item.storyPoints > 0 && (
              <span className="item-points">{item.storyPoints} SP</span>
            )}
            <span className="item-project">{item.project}</span>
          </div>
          <a 
            href={getJiraUrl(item.key)} 
            target="_blank" 
            rel="noopener noreferrer"
            className="item-key"
          >
            {item.key}
          </a>
        </div>
        <div className="item-title">{item.summary}</div>
        {hasDescription && (
          <div className="item-description-wrapper">
            <p className={`item-description ${isExpanded ? 'expanded' : ''}`}>
              {isExpanded ? item.description : truncateDescription(item.description)}
            </p>
            {item.description.length > 200 && (
              <button 
                className="description-toggle"
                onClick={() => toggleDescription(itemKey)}
              >
                {isExpanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        )}
        <div className="item-dates">
          {item.created && <span>Started: {formatDate(item.created)}</span>}
          {item.resolved && <span>Resolved: {formatDate(item.resolved)}</span>}
        </div>
      </div>
    );
  };

  const renderGitHubItem = (item) => (
    <div key={`gh-${item.id}`} className="logbook-item github-item">
      <div className="item-header">
        <div className="item-meta">
          <span className={`item-state state-${item.state}`}>
            {item.state === 'merged' ? 'Merged' : item.state}
          </span>
          <span className="item-repo">{item.repo}</span>
        </div>
        <a 
          href={item.url} 
          target="_blank" 
          rel="noopener noreferrer"
          className="item-key"
        >
          #{item.number}
        </a>
      </div>
      <div className="item-title">{item.title}</div>
      <div className="item-dates">
        {item.created && <span>Opened: {formatDate(item.created)}</span>}
        {item.merged && <span>Merged: {formatDate(item.merged)}</span>}
      </div>
    </div>
  );

  const renderGitLabItem = (item) => (
    <div key={`gl-${item.id}`} className="logbook-item gitlab-item">
      <div className="item-header">
        <div className="item-meta">
          <span className={`item-state state-${item.state}`}>
            {item.state === 'merged' ? 'Merged' : item.state}
          </span>
          <span className="item-repo">{item.project}</span>
        </div>
        <a 
          href={item.url} 
          target="_blank" 
          rel="noopener noreferrer"
          className="item-key"
        >
          !{item.iid}
        </a>
      </div>
      <div className="item-title">{item.title}</div>
      <div className="item-dates">
        {item.created && <span>Opened: {formatDate(item.created)}</span>}
        {item.merged && <span>Merged: {formatDate(item.merged)}</span>}
      </div>
    </div>
  );

  const renderMonthCard = (monthData) => {
    const isExpanded = expandedMonths.has(monthData.month);
    const { metrics, items } = monthData;
    
    return (
      <div key={monthData.month} className={`month-card ${isExpanded ? 'expanded' : ''}`}>
        <button 
          className="month-header"
          onClick={() => toggleMonth(monthData.month)}
          aria-expanded={isExpanded}
        >
          <div className="month-title">
            <span className="month-marker" />
            <h2>{monthData.label}</h2>
          </div>
          <div className="month-metrics">
            {metrics.jiraIssues > 0 && renderMetricsBadge('Issues', metrics.jiraIssues, SOURCE_JIRA)}
            {metrics.githubPRs > 0 && renderMetricsBadge('PRs', metrics.githubPRs, SOURCE_GITHUB)}
            {metrics.gitlabMRs > 0 && renderMetricsBadge('MRs', metrics.gitlabMRs, SOURCE_GITLAB)}
            {metrics.storyPoints > 0 && renderMetricsBadge('SP', metrics.storyPoints, 'points')}
          </div>
          <span className="expand-icon">{isExpanded ? '−' : '+'}</span>
        </button>
        
        {isExpanded && (
          <div className="month-content">
            {items.jira.length > 0 && (
              <section className="source-section jira-section">
                <h3>
                  <span className="source-icon">📋</span>
                  Jira Issues ({items.jira.length})
                </h3>
                <div className="items-list">
                  {items.jira.map(renderJiraItem)}
                </div>
              </section>
            )}
            
            {items.github.length > 0 && (
              <section className="source-section github-section">
                <h3>
                  <span className="source-icon">🐙</span>
                  GitHub Pull Requests ({items.github.length})
                </h3>
                <div className="items-list">
                  {items.github.map(renderGitHubItem)}
                </div>
              </section>
            )}
            
            {items.gitlab.length > 0 && (
              <section className="source-section gitlab-section">
                <h3>
                  <span className="source-icon">🦊</span>
                  GitLab Merge Requests ({items.gitlab.length})
                </h3>
                <div className="items-list">
                  {items.gitlab.map(renderGitLabItem)}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="logbook-page">
      <header className="page-header">
        <div>
          <h1>Engineering Logbook</h1>
          <p className="date-label">{dateRange.label}</p>
        </div>
        <div className="header-controls">
          <DateFilter value={dateRange} onChange={setDateRange} />
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="loading-container">
          <Skeleton variant="text" width="300px" height="40px" />
          <div className="skeleton-months">
            {[1, 2, 3].map(i => (
              <div key={i} className="skeleton-month">
                <Skeleton variant="text" width="100%" height="60px" />
              </div>
            ))}
          </div>
        </div>
      ) : logbookData && (
        <>
          {/* Summary Stats */}
          <div className="logbook-summary">
            <div className="summary-stat">
              <span className="stat-value">{logbookData.totals?.monthsActive || 0}</span>
              <span className="stat-label">Months Active</span>
            </div>
            <div className="summary-stat">
              <span className="stat-value">{logbookData.totals?.totalItems || 0}</span>
              <span className="stat-label">Total Items</span>
            </div>
            <div className="summary-stat jira">
              <span className="stat-value">{logbookData.totals?.jiraIssues || 0}</span>
              <span className="stat-label">Jira Issues</span>
            </div>
            <div className="summary-stat github">
              <span className="stat-value">{logbookData.totals?.githubPRs || 0}</span>
              <span className="stat-label">GitHub PRs</span>
            </div>
            <div className="summary-stat gitlab">
              <span className="stat-value">{logbookData.totals?.gitlabMRs || 0}</span>
              <span className="stat-label">GitLab MRs</span>
            </div>
            <div className="summary-stat points">
              <span className="stat-value">{logbookData.totals?.storyPoints || 0}</span>
              <span className="stat-label">Story Points</span>
            </div>
          </div>

          {/* Controls */}
          <div className="logbook-controls">
            <button onClick={expandAll} className="control-btn">
              Expand All
            </button>
            <button onClick={collapseAll} className="control-btn">
              Collapse All
            </button>
            <button onClick={() => window.print()} className="control-btn print-btn">
              Print / Export
            </button>
          </div>

          {/* Timeline */}
          <div className="logbook-timeline">
            {logbookData.months?.length > 0 ? (
              logbookData.months.map(renderMonthCard)
            ) : (
              <div className="empty-state">
                <p>No work items found for the selected date range.</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default LogbookPage;

