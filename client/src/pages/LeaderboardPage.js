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

// Metric definitions for the comparison table
const COMPARISON_METRICS = [
  { key: 'created', label: 'Created', description: 'PRs/MRs created' },
  { key: 'commentsPerMonth', label: 'Comments/Month', description: 'Average comments per month' },
  { key: 'velocity', label: 'Velocity', description: 'Avg story points per sprint' },
  { key: 'resolved', label: 'Resolved', description: 'Issues resolved' }
];

// Comparison Table Component
function ComparisonTable({ currentUserStats, benchmarks, loading }) {
  const formatValue = (value, suffix = '') => {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'number') {
      return value.toLocaleString(undefined, { maximumFractionDigits: 1 }) + suffix;
    }
    return value;
  };

  const renderLoadingRows = () => {
    return COMPARISON_METRICS.map((metric) => (
      <tr key={metric.key}>
        <td className="metric-label">{metric.label}</td>
        <td className="you-column"><Skeleton variant="text" width="50px" height="16px" /></td>
        <td><Skeleton variant="text" width="50px" height="16px" /></td>
        <td><Skeleton variant="text" width="50px" height="16px" /></td>
        <td><Skeleton variant="text" width="50px" height="16px" /></td>
        <td><Skeleton variant="text" width="50px" height="16px" /></td>
        <td><Skeleton variant="text" width="50px" height="16px" /></td>
      </tr>
    ));
  };

  return (
    <div className="comparison-table-container">
      <h2 className="comparison-title">Your Stats vs Team Averages</h2>
      <table className="comparison-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th className="you-column">You</th>
            <th>Avg P1</th>
            <th>Avg P2</th>
            <th>Avg P3</th>
            <th>Avg P4</th>
            <th>Avg FTE</th>
          </tr>
        </thead>
        <tbody>
          {loading ? renderLoadingRows() : COMPARISON_METRICS.map((metric) => {
            const userValue = currentUserStats?.[metric.key];
            const suffix = metric.suffix || '';
            
            return (
              <tr key={metric.key}>
                <td className="metric-label" title={metric.description}>{metric.label}</td>
                <td className="you-column">{formatValue(userValue, suffix)}</td>
                <td>{formatValue(benchmarks?.p1?.[metric.key], suffix)}</td>
                <td>{formatValue(benchmarks?.p2?.[metric.key], suffix)}</td>
                <td>{formatValue(benchmarks?.p3?.[metric.key], suffix)}</td>
                <td>{formatValue(benchmarks?.p4?.[metric.key], suffix)}</td>
                <td>{formatValue(benchmarks?.fte?.[metric.key], suffix)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

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
    setLoading(true);
    setError(null);
    
    // Build API URL and cache key
    const cacheKey = buildApiUrl('/api/stats/leaderboard', dateRange);
    
    // Check cache first for instant display - only use if it matches current date range
    const cached = clientCache.get(cacheKey, dateRange);
    if (cached) {
      setLeaderboard(cached);
      // Don't set loading to false here - we still want to fetch fresh data
    }
    
    try {
      // Always fetch fresh data to ensure we have the correct date range
      // Increase timeout for leaderboard (30+ users × 3 services = many API calls)
      const response = await axios.get(cacheKey + mockParam, {
        timeout: 120000 // 2 minutes timeout
      });
      
      const data = response.data || [];
      setLeaderboard(data);
      // Update cache with fresh data for this specific date range
      clientCache.set(cacheKey, dateRange, data);
    } catch (err) {
      if (err.code === 'ECONNABORTED') {
        setError('Request timed out. The leaderboard is loading many users - please wait or try again.');
      } else {
        setError('Failed to fetch leaderboard. Please check your API configuration.');
      }
      console.error('Error fetching leaderboard:', err);
      
      // If we have cached data, keep showing it even on error
      // Otherwise clear the leaderboard
      if (!cached) {
        setLeaderboard([]);
      }
    } finally {
      setLoading(false);
    }
  }, [dateRange, mockParam]);

  // Clear leaderboard and show loading when date range changes
  useEffect(() => {
    setLeaderboard([]);
    setLoading(true);
    setError(null);
  }, [dateRange.start, dateRange.end]);

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

  // Helper function to calculate months in date range
  const calculateMonthsInRange = useCallback((dr) => {
    if (!dr) return 1;
    const start = dr.start ? new Date(dr.start) : null;
    const end = dr.end ? new Date(dr.end) : new Date();
    if (!start) return 1;
    const startYear = start.getUTCFullYear();
    const startMonth = start.getUTCMonth();
    const endYear = end.getUTCFullYear();
    const endMonth = end.getUTCMonth();
    const monthsDiff = (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
    return Math.max(1, monthsDiff);
  }, []);

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
          // Reviews = PRs/MRs reviewed (not comments)
          const aGithubReviews = a.reviewStats?.github?.prsReviewed || a.github?.reviews || 0;
          const aGitlabReviews = a.reviewStats?.gitlab?.mrsReviewed || 0;
          const bGithubReviews = b.reviewStats?.github?.prsReviewed || b.github?.reviews || 0;
          const bGitlabReviews = b.reviewStats?.gitlab?.mrsReviewed || 0;
          aValue = aGithubReviews + aGitlabReviews;
          bValue = bGithubReviews + bGitlabReviews;
          break;
        case 'git-comments':
          // Comments = Total comments made
          const aGithubComments = a.reviewStats?.github?.totalComments || 0;
          const aGitlabComments = a.reviewStats?.gitlab?.totalComments || 0;
          const bGithubComments = b.reviewStats?.github?.totalComments || 0;
          const bGitlabComments = b.reviewStats?.gitlab?.totalComments || 0;
          aValue = aGithubComments + aGitlabComments;
          bValue = bGithubComments + bGitlabComments;
          break;
        case 'git-comments-per-month':
          // Comments per month = Total comments / months in range
          const aTotalComments = (a.reviewStats?.github?.totalComments || 0) + (a.reviewStats?.gitlab?.totalComments || 0);
          const bTotalComments = (b.reviewStats?.github?.totalComments || 0) + (b.reviewStats?.gitlab?.totalComments || 0);
          const totalMonths = calculateMonthsInRange(dateRange);
          aValue = totalMonths > 0 ? aTotalComments / totalMonths : 0;
          bValue = totalMonths > 0 ? bTotalComments / totalMonths : 0;
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
  }, [leaderboard, sortConfig, dateRange, calculateMonthsInRange]);

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

  // Extract current user's stats for comparison table
  const currentUserStats = useMemo(() => {
    const currentUserEntry = leaderboard.find(entry => isCurrentUser(entry));
    if (!currentUserEntry) return null;
    
    const github = currentUserEntry.github || {};
    const gitlab = currentUserEntry.gitlab || {};
    const jira = currentUserEntry.jira || {};
    const reviewStats = currentUserEntry.reviewStats || {};
    
    // Git Created
    const githubCreated = github.created > 0 ? github.created : (github.total ?? 0);
    const gitlabCreated = gitlab.created ?? gitlab.total ?? 0;
    const created = githubCreated + gitlabCreated;
    
    // Git Reviews
    const githubReviews = reviewStats.github?.prsReviewed || github.reviews || 0;
    const gitlabReviews = reviewStats.gitlab?.mrsReviewed || 0;
    const reviews = githubReviews + gitlabReviews;
    
    // Git Comments
    const githubComments = reviewStats.github?.totalComments || 0;
    const gitlabComments = reviewStats.gitlab?.totalComments || 0;
    const comments = githubComments + gitlabComments;
    
    // Comments per month
    const totalMonthsInRange = calculateMonthsInRange(dateRange);
    const commentsPerMonth = totalMonthsInRange > 0 ? parseFloat((comments / totalMonthsInRange).toFixed(1)) : 0;
    
    // Jira metrics
    const velocity = jira.velocity?.averageVelocity || 0;
    const storyPoints = jira.totalStoryPoints || 0;
    const resolved = jira.resolved || 0;
    const avgResolutionTime = jira.avgResolutionTime || 0;
    const ctoiFixed = jira.ctoi?.fixed || 0;
    const ctoiParticipated = jira.ctoi?.participated || 0;
    
    return {
      created,
      reviews,
      comments,
      commentsPerMonth,
      velocity,
      storyPoints,
      resolved,
      avgResolutionTime,
      ctoiFixed,
      ctoiParticipated
    };
  }, [leaderboard, isCurrentUser, dateRange, calculateMonthsInRange]);

  // Calculate benchmarks from leaderboard data (no extra API call needed)
  const benchmarks = useMemo(() => {
    const CONTRACTOR_LEVEL = 'contractor';
    
    if (!leaderboard || leaderboard.length === 0) return null;
    
    const extractMetrics = (entry) => {
      const github = entry.github || {};
      const gitlab = entry.gitlab || {};
      const jira = entry.jira || {};
      const reviewStats = entry.reviewStats || {};
      
      const githubCreated = github.created > 0 ? github.created : (github.total ?? 0);
      const gitlabCreated = gitlab.created ?? gitlab.total ?? 0;
      const created = githubCreated + gitlabCreated;
      
      const githubReviews = reviewStats.github?.prsReviewed || github.reviews || 0;
      const gitlabReviews = reviewStats.gitlab?.mrsReviewed || 0;
      const reviews = githubReviews + gitlabReviews;
      
      const githubComments = reviewStats.github?.totalComments || 0;
      const gitlabComments = reviewStats.gitlab?.totalComments || 0;
      const comments = githubComments + gitlabComments;
      
      const monthsInRange = calculateMonthsInRange(dateRange);
      const commentsPerMonth = monthsInRange > 0 ? comments / monthsInRange : 0;
      
      const velocity = jira.velocity?.averageVelocity || 0;
      const storyPoints = jira.totalStoryPoints || 0;
      const resolved = jira.resolved || 0;
      const avgResolutionTime = jira.avgResolutionTime || 0;
      const ctoiFixed = jira.ctoi?.fixed || 0;
      const ctoiParticipated = jira.ctoi?.participated || 0;
      
      return { created, reviews, comments, commentsPerMonth, velocity, storyPoints, resolved, avgResolutionTime, ctoiFixed, ctoiParticipated };
    };
    
    const calculateAverages = (entries) => {
      if (entries.length === 0) return null;
      
      const metrics = ['created', 'reviews', 'comments', 'commentsPerMonth', 'velocity', 'storyPoints', 'resolved', 'avgResolutionTime', 'ctoiFixed', 'ctoiParticipated'];
      const sums = {};
      const counts = {};
      metrics.forEach(m => { sums[m] = 0; counts[m] = 0; });
      
      entries.forEach(entry => {
        const m = extractMetrics(entry);
        metrics.forEach(key => {
          if (m[key] > 0) { sums[key] += m[key]; counts[key]++; }
        });
      });
      
      const result = {};
      metrics.forEach(key => {
        result[key] = counts[key] > 0 ? parseFloat((sums[key] / counts[key]).toFixed(1)) : null;
      });
      return result;
    };
    
    const usersByLevel = { p1: [], p2: [], p3: [], p4: [] };
    leaderboard.forEach(entry => {
      const level = entry.user?.level?.toLowerCase();
      if (level && level !== CONTRACTOR_LEVEL && usersByLevel[level]) {
        usersByLevel[level].push(entry);
      }
    });
    
    return {
      fte: calculateAverages(leaderboard),
      p1: calculateAverages(usersByLevel.p1),
      p2: calculateAverages(usersByLevel.p2),
      p3: calculateAverages(usersByLevel.p3),
      p4: calculateAverages(usersByLevel.p4)
    };
  }, [leaderboard, dateRange, calculateMonthsInRange]);

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
                <th>Comments</th>
                <th>Comments/Month</th>
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
        <ComparisonTable 
          currentUserStats={null} 
          benchmarks={null} 
          loading={true} 
        />
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
          <strong>Created</strong> = PRs/MRs created (GitHub + GitLab). 
          <strong>Reviews</strong> = PRs/MRs reviewed (not authored by you). 
          <strong>Comments</strong> = Total comments made on PRs/MRs. 
          <strong>Comments/Month</strong> = Average comments per month in the date range.
        </p>
      </div>
      
      <ComparisonTable 
        currentUserStats={currentUserStats} 
        benchmarks={benchmarks} 
        loading={loading && !benchmarks} 
      />
      
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
                <th onClick={() => handleSort('git-reviews')} className="sortable" title="PRs/MRs reviewed (GitHub + GitLab)">
                  Reviews {getSortIcon('git-reviews')}
                </th>
                <th onClick={() => handleSort('git-comments')} className="sortable" title="Total comments made on PRs/MRs (GitHub + GitLab)">
                  Comments {getSortIcon('git-comments')}
                </th>
                <th onClick={() => handleSort('git-comments-per-month')} className="sortable" title="Average comments per month">
                  Comments/Month {getSortIcon('git-comments-per-month')}
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
                
                // Reviews = PRs/MRs reviewed (not comments)
                const githubReviews = entry.reviewStats?.github?.prsReviewed || entry.github?.reviews || 0;
                const gitlabReviews = entry.reviewStats?.gitlab?.mrsReviewed || 0;
                const gitReviews = githubReviews + gitlabReviews;
                
                // Comments = Total comments made
                const githubComments = entry.reviewStats?.github?.totalComments || 0;
                const gitlabComments = entry.reviewStats?.gitlab?.totalComments || 0;
                const gitComments = githubComments + gitlabComments;
                
                // Comments per month
                const totalMonthsInRange = calculateMonthsInRange(dateRange);
                const gitCommentsPerMonth = totalMonthsInRange > 0 ? (gitComments / totalMonthsInRange) : 0;
                
                const isCurrentUserRow = isCurrentUser(entry);
                
                return (
                  <tr key={entry.user?.id || index} className={isCurrentUserRow ? 'current-user-row' : ''}>
                    <td className={`name-cell ${isCurrentUserRow ? 'current-user-name' : ''}`}>{displayName}</td>
                    <td>{formatValue(gitCreated)}</td>
                    <td>{formatValue(gitReviews)}</td>
                    <td>{formatValue(gitComments)}</td>
                    <td>{gitCommentsPerMonth > 0 ? gitCommentsPerMonth.toFixed(1) : '-'}</td>
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

