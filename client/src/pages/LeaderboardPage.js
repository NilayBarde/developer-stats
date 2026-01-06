import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import DateFilter from '../components/DateFilter';
import { getCurrentWorkYearStart, formatWorkYearLabel } from '../utils/dateHelpers';
import { buildApiUrl } from '../utils/apiHelpers';
import Skeleton from '../components/ui/Skeleton';
import clientCache from '../utils/clientCache';
import './LeaderboardPage.css';

// Current user identifier - update this to match your user ID
const CURRENT_USER_ID = 'NILAY-BARDE';

function LeaderboardPage() {
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortConfig, setSortConfig] = useState({ column: null, direction: 'asc' });
  
  const mockParam = new URLSearchParams(window.location.search).get('mock') === 'true' ? '&mock=true' : '';
  
  const workYearStart = getCurrentWorkYearStart();
  const [dateRange, setDateRange] = useState({
    label: formatWorkYearLabel(workYearStart),
    start: workYearStart,
    end: null,
    type: 'custom'
  });

  const fetchLeaderboard = useCallback(async () => {
    // Check cache first for instant display
    const cacheKey = buildApiUrl('/api/stats/leaderboard', dateRange);
    const cached = clientCache.get(cacheKey, dateRange);
    if (cached) {
      setLeaderboard(cached);
      setLoading(false);
      setError(null);
    }
    
    try {
      if (!cached) setLoading(true);
      setError(null);
      
      // Increase timeout for leaderboard (30+ users × 3 services = many API calls)
      const response = await axios.get(cacheKey + mockParam, {
        timeout: 120000 // 2 minutes timeout
      });
      
      const data = response.data || [];
      setLeaderboard(data);
      clientCache.set(cacheKey, dateRange, data);
    } catch (err) {
      if (err.code === 'ECONNABORTED') {
        setError('Request timed out. The leaderboard is loading many users - please wait or try again.');
      } else {
        setError('Failed to fetch leaderboard. Please check your API configuration.');
      }
      console.error('Error fetching leaderboard:', err);
      
      // If we have cached data, keep showing it even on error
      // Use functional update to avoid needing leaderboard in dependencies
      if (!cached) {
        setLeaderboard(prev => prev.length === 0 ? [] : prev);
      }
    } finally {
      setLoading(false);
    }
  }, [dateRange, mockParam]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  const handleSort = (column) => {
    let direction = 'asc';
    if (sortConfig.column === column && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ column, direction });
  };

  const sortedLeaderboard = useMemo(() => {
    if (!sortConfig.column) return leaderboard;
    
    return [...leaderboard].sort((a, b) => {
      let aValue, bValue;
      
      switch (sortConfig.column) {
        case 'name':
          aValue = a.user?.id || a.user?.githubUsername || a.user?.gitlabUsername || a.user?.jiraEmail || '';
          bValue = b.user?.id || b.user?.githubUsername || b.user?.gitlabUsername || b.user?.jiraEmail || '';
          break;
        case 'git-created':
          aValue = (a.github?.created || 0) + (a.gitlab?.created || 0);
          bValue = (b.github?.created || 0) + (b.gitlab?.created || 0);
          break;
        case 'git-reviews':
          aValue = (a.github?.reviews || 0) + (a.gitlab?.commented || 0) + (a.gitlab?.approved || 0);
          bValue = (b.github?.reviews || 0) + (b.gitlab?.commented || 0) + (b.gitlab?.approved || 0);
          break;
        case 'jira-velocity':
          aValue = a.jira?.velocity?.averageVelocity || 0;
          bValue = b.jira?.velocity?.averageVelocity || 0;
          break;
        case 'jira-story-points':
          aValue = a.jira?.totalStoryPoints || 0;
          bValue = b.jira?.totalStoryPoints || 0;
          break;
        case 'jira-resolved':
          aValue = a.jira?.resolved || 0;
          bValue = b.jira?.resolved || 0;
          break;
        case 'jira-resolution-time':
          aValue = a.jira?.avgResolutionTime || 0;
          bValue = b.jira?.avgResolutionTime || 0;
          break;
        case 'jira-ctoi-fixed':
          aValue = a.jira?.ctoi?.fixed || 0;
          bValue = b.jira?.ctoi?.fixed || 0;
          break;
        case 'jira-ctoi-participated':
          aValue = a.jira?.ctoi?.participated || 0;
          bValue = b.jira?.ctoi?.participated || 0;
          break;
        default:
          return 0;
      }
      
      if (typeof aValue === 'string') {
        return sortConfig.direction === 'asc' 
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }
      
      return sortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
    });
  }, [leaderboard, sortConfig]);

  const formatValue = (value) => {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'number') {
      return value.toLocaleString();
    }
    return value;
  };

  const getSortIcon = (column) => {
    if (sortConfig.column !== column) return '↕';
    return sortConfig.direction === 'asc' ? '↑' : '↓';
  };

  const isCurrentUser = useCallback((entry) => {
    const userId = entry.user?.id;
    const githubUsername = entry.user?.githubUsername;
    const gitlabUsername = entry.user?.gitlabUsername;
    const jiraEmail = entry.user?.jiraEmail;
    
    return userId === CURRENT_USER_ID ||
           githubUsername?.toUpperCase() === CURRENT_USER_ID ||
           gitlabUsername === CURRENT_USER_ID ||
           jiraEmail?.toLowerCase() === 'nilay.barde@disney.com';
  }, []);

  const renderLoadingTable = () => {
    const skeletonRows = Array.from({ length: 10 }, (_, i) => i);
    
    return (
      <div className="leaderboard-table-container">
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Created</th>
              <th>Reviews</th>
              <th>Velocity</th>
              <th>Story Points</th>
              <th>Resolved</th>
              <th>Avg Res Time</th>
              <th>CTOI Fixed</th>
              <th>CTOI Part.</th>
            </tr>
          </thead>
          <tbody>
            {skeletonRows.map((_, index) => (
              <tr key={index}>
                <td className="name-cell">
                  <Skeleton variant="text" width="80%" height="16px" />
                </td>
                <td><Skeleton variant="text" width="60%" height="16px" /></td>
                <td><Skeleton variant="text" width="60%" height="16px" /></td>
                <td><Skeleton variant="text" width="60%" height="16px" /></td>
                <td><Skeleton variant="text" width="60%" height="16px" /></td>
                <td><Skeleton variant="text" width="60%" height="16px" /></td>
                <td><Skeleton variant="text" width="60%" height="16px" /></td>
                <td><Skeleton variant="text" width="60%" height="16px" /></td>
                <td><Skeleton variant="text" width="60%" height="16px" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  if (loading && leaderboard.length === 0) {
    return (
      <div className="leaderboard-page">
        <header className="leaderboard-header">
          <h1>Leaderboard</h1>
          <DateFilter value={dateRange} onChange={setDateRange} />
        </header>
        <div className="loading-message">
          <p>Loading leaderboard for all users... This may take a minute.</p>
        </div>
        {renderLoadingTable()}
      </div>
    );
  }

  if (error) {
    return (
      <div className="leaderboard-page">
        <header className="leaderboard-header">
          <h1>Leaderboard</h1>
          <DateFilter value={dateRange} onChange={setDateRange} />
        </header>
        <div className="error-banner">{error}</div>
      </div>
    );
  }

  return (
    <div className="leaderboard-page">
      <header className="leaderboard-header">
        <h1>Leaderboard</h1>
        <DateFilter value={dateRange} onChange={setDateRange} />
      </header>
      
      <div className="leaderboard-info">
        <p className="info-text">
          <strong>Git (GitHub + GitLab)</strong> combines metrics from both code hosting platforms. 
          <strong>Created</strong> = PRs/MRs created (GitHub + GitLab), <strong>Reviews</strong> = Reviews/comments given (GitHub reviews + GitLab commented/approved).
        </p>
      </div>
      
      {leaderboard.length === 0 ? (
        <div className="empty-state">
          <p>No users configured. Please add users to the config file.</p>
        </div>
      ) : (
        <div className="leaderboard-table-container">
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th onClick={() => handleSort('name')} className="sortable">
                  Name {getSortIcon('name')}
                </th>
                <th onClick={() => handleSort('git-created')} className="sortable" title="PRs/MRs created (GitHub + GitLab)">
                  Created {getSortIcon('git-created')}
                </th>
                <th onClick={() => handleSort('git-reviews')} className="sortable" title="Reviews/comments given (GitHub reviews + GitLab commented/approved)">
                  Reviews {getSortIcon('git-reviews')}
                </th>
                <th onClick={() => handleSort('jira-velocity')} className="sortable" title="Average story points per sprint">
                  Velocity {getSortIcon('jira-velocity')}
                </th>
                <th onClick={() => handleSort('jira-story-points')} className="sortable" title="Total story points completed">
                  Story Points {getSortIcon('jira-story-points')}
                </th>
                <th onClick={() => handleSort('jira-resolved')} className="sortable" title="Issues resolved">
                  Resolved {getSortIcon('jira-resolved')}
                </th>
                <th onClick={() => handleSort('jira-resolution-time')} className="sortable" title="Average time to resolve issues (days)">
                  Avg Res Time {getSortIcon('jira-resolution-time')}
                </th>
                <th onClick={() => handleSort('jira-ctoi-fixed')} className="sortable" title="CTOI issues fixed">
                  CTOI Fixed {getSortIcon('jira-ctoi-fixed')}
                </th>
                <th onClick={() => handleSort('jira-ctoi-participated')} className="sortable" title="CTOI issues participated in">
                  CTOI Part. {getSortIcon('jira-ctoi-participated')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedLeaderboard.map((entry, index) => {
                const displayName = entry.user?.id || entry.user?.githubUsername || entry.user?.gitlabUsername || entry.user?.jiraEmail || '-';
                const gitCreated = (entry.github?.created || 0) + (entry.gitlab?.created || 0);
                const gitReviews = (entry.github?.reviews || 0) + (entry.gitlab?.commented || 0) + (entry.gitlab?.approved || 0);
                const isCurrentUserRow = isCurrentUser(entry);
                
                return (
                  <tr key={entry.user?.id || index} className={isCurrentUserRow ? 'current-user-row' : ''}>
                    <td className={`name-cell ${isCurrentUserRow ? 'current-user-name' : ''}`}>{displayName}</td>
                    <td>{formatValue(gitCreated)}</td>
                    <td>{formatValue(gitReviews)}</td>
                    <td>{formatValue(entry.jira?.velocity?.averageVelocity)}</td>
                    <td>{formatValue(entry.jira?.totalStoryPoints)}</td>
                    <td>{formatValue(entry.jira?.resolved)}</td>
                    <td>{entry.jira?.avgResolutionTime ? `${formatValue(entry.jira.avgResolutionTime)}d` : '-'}</td>
                    <td>{formatValue(entry.jira?.ctoi?.fixed)}</td>
                    <td>{formatValue(entry.jira?.ctoi?.participated)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default LeaderboardPage;

