import React, { useState, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import axios from 'axios';
import './PromotionPage.css';
import { getCurrentWorkYearStart, formatWorkYearLabel } from '../utils/dateHelpers';
import { buildApiUrl } from '../utils/apiHelpers';

// Local storage key for persisting promotion data
const STORAGE_KEY = 'promotion-tracker-data';

// P3 Requirements Data - Based on Software Engineering Job Family Framework
// These are P2 → P3 (Sr Software Engineer) promotion requirements
const P3_REQUIREMENTS = {
  proficiency: [
    { id: 'bugs', label: 'Fixing high complexity bugs', description: 'Demonstrate ability to debug and resolve complex, multi-system issues that span multiple services' },
    { id: 'epics', label: 'Implementing epics and larger features', description: 'Lead implementation of full epics end-to-end, not just individual stories or tasks' },
    { id: 'coordination', label: 'Coordinating work among team members', description: 'Organize, delegate, and track work across the team effectively' },
    { id: 'arch-review', label: 'Reviewing architectural designs and solutions', description: 'Participate in and contribute to architecture discussions and design reviews' },
  ],
  // P2 → P3 Enabling Experiences (from Job Family Framework)
  enablingExperiences: [
    { id: 'high-level-designs', label: 'Develops end-to-end high level designs', description: 'Create comprehensive technical designs that span multiple components or systems' },
    { id: 'business-leadership', label: 'Initiative to learn business processes and leadership', description: 'Applied learning of additional skills around business processes and leadership' },
    { id: 'business-areas', label: 'Familiarity with variety of business areas', description: 'Develop knowledge across multiple product and industry areas, not just your immediate domain' },
    { id: 'cross-technical', label: 'Collaborates across technical areas', description: 'Work effectively across product, application, and systems teams' },
    { id: 'leads-small-teams', label: 'Leads small teams on cross-functional projects', description: 'Lead small teams and work on cross-functional teams to deliver small projects' },
    { id: 'plans-actions', label: 'Autonomously develops plans of action', description: 'Independently articulate plans, activities, and tasks associated with delivery of services' },
    { id: 'autonomy', label: 'Autonomously delivers projects of increasing scope', description: 'Handle increasingly complex projects with minimal oversight and guidance' },
    { id: 'communication', label: 'Clearly communicates with constructive approach', description: 'Ask inquisitive questions and follow a constructive approach in discussions' },
    { id: 'change-agent', label: 'Change agent in optimizing service delivery', description: 'Demonstrate initiative to improve and enhance how services are delivered' },
  ],
  documentation: [
    { id: 'resume', label: 'Updated Resume', description: 'Current resume highlighting relevant experience' },
    { id: 'self-assessment', label: 'Self-Assessment (max 1 page)', description: 'Written narrative demonstrating P3 capabilities' },
    { id: 'artifacts', label: 'Artifacts attached', description: 'Design docs, code submissions, etc.' },
    { id: 'manager-assessment', label: 'Manager Assessment', description: 'Manager provides supporting documentation' },
    { id: 'peer-1', label: 'Peer Assessment #1', description: 'From peer at P3 level or above' },
    { id: 'peer-2', label: 'Peer Assessment #2', description: 'From peer at P3 level or above' },
    { id: 'peer-3', label: 'Peer Assessment #3', description: 'From peer at P3 level or above' },
    { id: 'peer-4', label: 'Peer Assessment #4', description: 'From peer at P3 level or above' },
  ],
  values: [
    { id: 'creativity', label: 'Creativity', description: 'TWDC Value - Innovative thinking and solutions' },
    { id: 'collaboration-val', label: 'Collaboration', description: 'TWDC Value - Working effectively with others' },
    { id: 'integrity', label: 'Integrity', description: 'TWDC Value - Honest and ethical behavior' },
    { id: 'community', label: 'Community', description: 'TWDC Value - Contributing to team culture' },
    { id: 'inclusion', label: 'Inclusion', description: 'TWDC Value - Fostering diverse perspectives' },
    { id: 'users-first', label: 'Users First', description: 'DEEP&T Principle - Prioritizing user needs' },
    { id: 'velocity', label: 'Velocity', description: 'DEEP&T Principle - Moving fast with quality' },
    { id: 'innovation', label: 'Innovation', description: 'DEEP&T Principle - Pushing boundaries' },
    { id: 'impact', label: 'Impact', description: 'DEEP&T Principle - Delivering meaningful outcomes' },
    { id: 'optimism', label: 'Optimism', description: 'DEEP&T Principle - Positive approach to challenges' },
  ]
};

const DEFAULT_STATE = {
  checkedItems: {},
  artifacts: [],
  peerAssessments: [
    { name: '', email: '', status: 'not-requested', level: '' },
    { name: '', email: '', status: 'not-requested', level: '' },
    { name: '', email: '', status: 'not-requested', level: '' },
    { name: '', email: '', status: 'not-requested', level: '' },
  ],
  notes: '',
  targetDate: '',
  managerDiscussed: false,
  performanceRating: 'top-performer', // FY25 End of Year Review Rating
};

function PromotionPage() {
  const location = useLocation();
  const queryString = location.search;
  const mockParam = new URLSearchParams(queryString).get('mock') === 'true' ? '&mock=true' : '';
  
  const [data, setData] = useState(DEFAULT_STATE);
  const [activeTab, setActiveTab] = useState('overview');
  const [newArtifact, setNewArtifact] = useState({ title: '', url: '', type: 'design-doc', description: '' });
  
  // Dashboard integration state
  const [dashboardStats, setDashboardStats] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [prs, setPrs] = useState([]);
  const [mrs, setMrs] = useState([]);
  const [issues, setIssues] = useState([]);
  
  // Date range presets for promotion metrics
  const DATE_PRESETS = React.useMemo(() => {
    const now = new Date();
    const workYearStart = getCurrentWorkYearStart();
    
    return [
      { 
        id: 'all-2025', 
        label: 'All of 2025', 
        start: '2025-01-01', 
        end: null,
        description: 'Full year view'
      },
      { 
        id: 'work-year', 
        label: formatWorkYearLabel(workYearStart), 
        start: workYearStart, 
        end: null,
        description: 'Current work year'
      },
      { 
        id: 'last-12-months', 
        label: 'Last 12 Months', 
        start: new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString().split('T')[0], 
        end: null,
        description: 'Rolling 12 months'
      },
      { 
        id: 'last-6-months', 
        label: 'Last 6 Months', 
        start: new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()).toISOString().split('T')[0], 
        end: null,
        description: 'Recent activity'
      },
      { 
        id: 'fy25', 
        label: 'FY25 (Oct 2024 - Sep 2025)', 
        start: '2024-10-01', 
        end: '2025-09-30',
        description: 'Full fiscal year'
      },
      { 
        id: 'custom', 
        label: 'Custom Range', 
        start: null, 
        end: null,
        description: 'Pick your own dates'
      },
    ];
  }, []);
  
  // Date range state - default to All of 2025
  const [selectedPreset, setSelectedPreset] = useState('all-2025');
  const [customStartDate, setCustomStartDate] = useState('2025-01-01');
  const [customEndDate, setCustomEndDate] = useState('');
  
  // Get the active date range based on selection
  const dateRange = React.useMemo(() => {
    if (selectedPreset === 'custom') {
      return {
        label: `${customStartDate} to ${customEndDate || 'Present'}`,
        start: customStartDate,
        end: customEndDate || null
      };
    }
    const preset = DATE_PRESETS.find(p => p.id === selectedPreset) || DATE_PRESETS[0];
    return {
      label: preset.label,
      start: preset.start,
      end: preset.end
    };
  }, [selectedPreset, customStartDate, customEndDate, DATE_PRESETS]);

  // Load data from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setData(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load saved data:', e);
      }
    }
  }, []);

  // Save data to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);
  
  // Fetch dashboard stats
  const fetchDashboardData = useCallback(async (range = dateRange) => {
    setDashboardLoading(true);
    try {
      const [statsRes, prsRes, mrsRes, issuesRes] = await Promise.all([
        axios.get(buildApiUrl('/api/stats', range) + mockParam),
        axios.get(buildApiUrl('/api/prs', range) + mockParam),
        axios.get(buildApiUrl('/api/mrs', range) + mockParam),
        axios.get(buildApiUrl('/api/issues', range) + mockParam)
      ]);
      
      setDashboardStats(statsRes.data);
      setPrs(prsRes.data.prs || []);
      setMrs(mrsRes.data.mrs || []);
      setIssues(issuesRes.data.issues || []);
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setDashboardLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mockParam]);
  
  // Refetch when date range changes
  useEffect(() => {
    if (dateRange.start) {
      fetchDashboardData(dateRange);
    }
  }, [dateRange, fetchDashboardData]);
  
  // Calculate derived stats
  const computedStats = React.useMemo(() => {
    if (!dashboardStats) return null;
    
    const github = dashboardStats.github || {};
    const gitlab = dashboardStats.gitlab || {};
    const jira = dashboardStats.jira || {};
    
    // PRs/MRs
    const totalPRs = (github.total || 0) + (gitlab.total || 0);
    const mergedPRs = (github.merged || 0) + (gitlab.merged || 0);
    const openPRs = (github.open || 0) + (gitlab.open || 0);
    
    // Code reviews
    const reviewComments = (github.reviewComments || 0) + (gitlab.reviewComments || 0);
    
    // Jira
    const totalIssues = jira.total || 0;
    const resolvedIssues = jira.resolved || 0;
    const storyPoints = jira.totalStoryPoints || 0;
    const storyPointsCompleted = jira.storyPointsCompleted || 0;
    const avgResolutionDays = jira.avgResolutionTime || 0;
    
    // Calculate key artifacts from PRs/MRs
    const significantPRs = [...prs, ...mrs]
      .filter(pr => {
        const title = (pr.title || '').toLowerCase();
        return title.includes('feat') || title.includes('feature') || 
               title.includes('refactor') || title.includes('arch') ||
               title.includes('design') || title.includes('epic');
      })
      .slice(0, 10);
    
    // Calculate repos touched
    const repos = new Set([
      ...(github.repoBreakdown || []).map(r => r.repo),
      ...(gitlab.repoBreakdown || []).map(r => r.repo)
    ]);
    
    // Calculate unique projects from issues
    const projects = new Set(issues.map(i => i.fields?.project?.key).filter(Boolean));
    
    return {
      totalPRs,
      mergedPRs,
      openPRs,
      reviewComments,
      totalIssues,
      resolvedIssues,
      storyPoints,
      storyPointsCompleted,
      avgResolutionDays,
      reposCount: repos.size,
      projectsCount: projects.size,
      significantPRs,
      github,
      gitlab,
      jira
    };
  }, [dashboardStats, prs, mrs, issues]);

  const toggleCheck = (id) => {
    setData(prev => ({
      ...prev,
      checkedItems: {
        ...prev.checkedItems,
        [id]: !prev.checkedItems[id]
      }
    }));
  };


  const addArtifact = () => {
    if (newArtifact.title && newArtifact.url) {
      setData(prev => ({
        ...prev,
        artifacts: [...prev.artifacts, { ...newArtifact, id: Date.now() }]
      }));
      setNewArtifact({ title: '', url: '', type: 'design-doc', description: '' });
    }
  };

  const removeArtifact = (id) => {
    setData(prev => ({
      ...prev,
      artifacts: prev.artifacts.filter(a => a.id !== id)
    }));
  };

  // Calculate progress
  const calculateProgress = () => {
    const allItems = [
      ...P3_REQUIREMENTS.proficiency,
      ...P3_REQUIREMENTS.enablingExperiences,
      ...P3_REQUIREMENTS.documentation,
    ];
    const checked = allItems.filter(item => data.checkedItems[item.id]).length;
    return Math.round((checked / allItems.length) * 100);
  };

  const getSectionProgress = (items) => {
    const checked = items.filter(item => data.checkedItems[item.id]).length;
    return { checked, total: items.length, percent: Math.round((checked / items.length) * 100) };
  };

  const progress = calculateProgress();
  const proficiencyProgress = getSectionProgress(P3_REQUIREMENTS.proficiency);
  const experienceProgress = getSectionProgress(P3_REQUIREMENTS.enablingExperiences);
  const docProgress = getSectionProgress(P3_REQUIREMENTS.documentation);

  const renderChecklistItem = (item) => (
    <label key={item.id} className={`checklist-item ${data.checkedItems[item.id] ? 'checked' : ''}`}>
      <input
        type="checkbox"
        checked={data.checkedItems[item.id] || false}
        onChange={() => toggleCheck(item.id)}
      />
      <div className="item-content">
        <span className="item-label">{item.label}</span>
        <span className="item-description">{item.description}</span>
      </div>
    </label>
  );

  return (
    <div className="promotion-page">
      <header className="promo-header">
        <div className="header-content">
          <div className="level-display">
            <div className="current-level">
              <span className="level-label">Current</span>
              <span className="level-badge p2">P2</span>
              <span className="level-title">Software Engineer II</span>
            </div>
            <div className="level-arrow">
              <svg width="48" height="24" viewBox="0 0 48 24">
                <path d="M0 12 L40 12 M32 4 L40 12 L32 20" stroke="currentColor" strokeWidth="2" fill="none" />
              </svg>
            </div>
            <div className="target-level">
              <span className="level-label">Target</span>
              <span className="level-badge p3">P3</span>
              <span className="level-title">Sr Software Engineer</span>
            </div>
          </div>
          
          <div className="progress-ring-container">
            <svg className="progress-ring" viewBox="0 0 120 120">
              <circle className="progress-bg" cx="60" cy="60" r="52" />
              <circle 
                className="progress-fill" 
                cx="60" 
                cy="60" 
                r="52" 
                style={{ strokeDasharray: `${progress * 3.27} 327` }}
              />
            </svg>
            <div className="progress-text">
              <span className="progress-number">{progress}%</span>
              <span className="progress-label">Ready</span>
            </div>
          </div>
        </div>
      </header>

      <nav className="promo-tabs">
        {[
          { id: 'overview', label: 'Overview', icon: '📋' },
          { id: 'metrics', label: 'My Metrics', icon: '📊' },
          { id: 'proficiency', label: 'Proficiency', icon: '⚡' },
          { id: 'experience', label: 'Experience', icon: '🎯' },
          { id: 'documentation', label: 'Documentation', icon: '📄' },
          { id: 'artifacts', label: 'Artifacts', icon: '🗂️' },
        ].map(tab => (
          <button
            key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="tab-icon">{tab.icon}</span>
            <span className="tab-label">{tab.label}</span>
          </button>
        ))}
      </nav>

      <main className="promo-content">
        {activeTab === 'overview' && (
          <div className="overview-tab">
            <div className="overview-grid">
              <div className="status-card">
                <h3>📅 Timeline</h3>
                <div className="form-group">
                  <label>Target Promotion Cycle</label>
                  <select 
                    value={data.targetDate} 
                    onChange={(e) => setData(prev => ({ ...prev, targetDate: e.target.value }))}
                  >
                    <option value="">Select cycle...</option>
                    <option value="Q2-2026">Q2 2026</option>
                    <option value="Q4-2026">Q4 2026</option>
                    <option value="Q2-2027">Q2 2027</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={data.managerDiscussed}
                      onChange={(e) => setData(prev => ({ ...prev, managerDiscussed: e.target.checked }))}
                    />
                    Discussed with manager
                  </label>
                </div>
                <div className="form-group">
                  <label>FY25 Performance Rating</label>
                  <div className="rating-display top-performer">
                    <span className="rating-badge">Top Performer</span>
                    <span className="rating-note">FY25 End of Year Review</span>
                  </div>
                </div>
              </div>

              <div className="status-card progress-summary">
                <h3>📊 Progress Summary</h3>
                <div className="progress-bars">
                  <div className="progress-item">
                    <div className="progress-header">
                      <span>Proficiency Requirements</span>
                      <span>{proficiencyProgress.checked}/{proficiencyProgress.total}</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${proficiencyProgress.percent}%` }} />
                    </div>
                  </div>
                  <div className="progress-item">
                    <div className="progress-header">
                      <span>Enabling Experiences</span>
                      <span>{experienceProgress.checked}/{experienceProgress.total}</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${experienceProgress.percent}%` }} />
                    </div>
                  </div>
                  <div className="progress-item">
                    <div className="progress-header">
                      <span>Documentation</span>
                      <span>{docProgress.checked}/{docProgress.total}</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${docProgress.percent}%` }} />
                    </div>
                  </div>
                  <div className="progress-item">
                    <div className="progress-header">
                      <span>Artifacts Collected</span>
                      <span>{data.artifacts.length}</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${Math.min(data.artifacts.length * 20, 100)}%` }} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="status-card requirements-highlight">
                <h3>⚠️ Key Requirements</h3>
                <ul className="requirements-list">
                  <li className={data.managerDiscussed ? 'complete' : ''}>
                    <span className="req-icon">{data.managerDiscussed ? '✓' : '○'}</span>
                    Manager discussion before self-nomination
                  </li>
                  <li className="complete">
                    <span className="req-icon">✓</span>
                    Top Performer rating (FY25)
                  </li>
                  <li className={data.checkedItems['self-assessment'] ? 'complete' : ''}>
                    <span className="req-icon">{data.checkedItems['self-assessment'] ? '✓' : '○'}</span>
                    Self-assessment (max 1 page)
                  </li>
                </ul>
              </div>

              <div className="status-card notes-card">
                <h3>📝 Notes & Planning</h3>
                <textarea
                  value={data.notes}
                  onChange={(e) => setData(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Add your notes, goals, and action items here..."
                  rows={8}
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'metrics' && (
          <div className="metrics-tab">
            <div className="tab-header">
              <h2>📊 My Dashboard Metrics</h2>
              <p>Auto-imported from your Engineering Stats Dashboard</p>
            </div>

            {/* Date Range Selector */}
            <div className="date-range-selector">
              <div className="date-range-header">
                <span className="date-range-icon">📅</span>
                <span className="date-range-title">Time Period</span>
                <span className="date-range-current">{dateRange.label}</span>
              </div>
              <div className="date-presets">
                {DATE_PRESETS.map(preset => (
                  <button
                    key={preset.id}
                    className={`preset-btn ${selectedPreset === preset.id ? 'active' : ''}`}
                    onClick={() => setSelectedPreset(preset.id)}
                  >
                    <span className="preset-label">{preset.label}</span>
                    <span className="preset-desc">{preset.description}</span>
                  </button>
                ))}
              </div>
              {selectedPreset === 'custom' && (
                <div className="custom-date-inputs">
                  <div className="date-input-group">
                    <label>Start Date</label>
                    <input
                      type="date"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                    />
                  </div>
                  <div className="date-input-group">
                    <label>End Date (optional)</label>
                    <input
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      placeholder="Present"
                    />
                  </div>
                </div>
              )}
              <div className="date-range-tip">
                💡 <strong>Pro tip:</strong> Try different time periods to find when your metrics look best for your promotion case!
              </div>
            </div>

            {dashboardLoading ? (
              <div className="loading-state">Loading your stats...</div>
            ) : computedStats ? (
              <>
                {/* Key Metrics Grid */}
                <div className="metrics-grid">
                  <div className="metric-card highlight">
                    <div className="metric-icon">🚀</div>
                    <div className="metric-value">{computedStats.totalPRs}</div>
                    <div className="metric-label">Total PRs/MRs</div>
                    <div className="metric-detail">{computedStats.mergedPRs} merged, {computedStats.openPRs} open</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-icon">💬</div>
                    <div className="metric-value">{computedStats.reviewComments}</div>
                    <div className="metric-label">Code Review Comments</div>
                    <div className="metric-detail">Engagement in team reviews</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-icon">🎫</div>
                    <div className="metric-value">{computedStats.totalIssues}</div>
                    <div className="metric-label">Jira Issues</div>
                    <div className="metric-detail">{computedStats.resolvedIssues} resolved</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-icon">⭐</div>
                    <div className="metric-value">{computedStats.storyPoints}</div>
                    <div className="metric-label">Story Points</div>
                    <div className="metric-detail">{computedStats.storyPointsCompleted} completed</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-icon">📁</div>
                    <div className="metric-value">{computedStats.reposCount}</div>
                    <div className="metric-label">Repositories</div>
                    <div className="metric-detail">Cross-repo contributions</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-icon">⏱️</div>
                    <div className="metric-value">{computedStats.avgResolutionDays.toFixed(1)}d</div>
                    <div className="metric-label">Avg Resolution</div>
                    <div className="metric-detail">In Progress → QA Ready</div>
                  </div>
                </div>

                {/* Source Breakdown */}
                <div className="source-breakdown">
                  <h3>📈 By Source</h3>
                  <div className="source-cards">
                    {computedStats.github && !computedStats.github.error && (
                      <div className="source-card github">
                        <div className="source-header">
                          <span className="source-icon">⬛</span>
                          <span>GitHub</span>
                        </div>
                        <div className="source-stats">
                          <span>{computedStats.github.total || 0} PRs</span>
                          <span>{computedStats.github.merged || 0} merged</span>
                          <span>{computedStats.github.reviewComments || 0} reviews</span>
                        </div>
                      </div>
                    )}
                    {computedStats.gitlab && !computedStats.gitlab.error && (
                      <div className="source-card gitlab">
                        <div className="source-header">
                          <span className="source-icon">🦊</span>
                          <span>GitLab</span>
                        </div>
                        <div className="source-stats">
                          <span>{computedStats.gitlab.total || 0} MRs</span>
                          <span>{computedStats.gitlab.merged || 0} merged</span>
                          <span>{computedStats.gitlab.reviewComments || 0} reviews</span>
                        </div>
                      </div>
                    )}
                    {computedStats.jira && !computedStats.jira.error && (
                      <div className="source-card jira">
                        <div className="source-header">
                          <span className="source-icon">📋</span>
                          <span>Jira</span>
                        </div>
                        <div className="source-stats">
                          <span>{computedStats.jira.total || 0} issues</span>
                          <span>{computedStats.jira.resolved || 0} resolved</span>
                          <span>{computedStats.jira.totalStoryPoints || 0} points</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Quick Links to Detail Pages */}
                <div className="quick-links-section">
                  <h3>🔗 Drill Down</h3>
                  <p className="quick-links-hint">Click to view detailed data with filters and artifact links</p>
                  <div className="quick-links-grid">
                    <Link to={`/prs${queryString}`} className="quick-link-card">
                      <span className="ql-icon">🔀</span>
                      <span className="ql-label">PRs / MRs</span>
                      <span className="ql-desc">All pull requests with links</span>
                    </Link>
                    <Link to={`/issues${queryString}`} className="quick-link-card">
                      <span className="ql-icon">🎫</span>
                      <span className="ql-label">Jira Issues</span>
                      <span className="ql-desc">All issues with story points</span>
                    </Link>
                    <Link to={`/projects${queryString}`} className="quick-link-card">
                      <span className="ql-icon">📁</span>
                      <span className="ql-label">Projects</span>
                      <span className="ql-desc">Epics and project groupings</span>
                    </Link>
                    <Link to={`/analytics${queryString}`} className="quick-link-card">
                      <span className="ql-icon">📊</span>
                      <span className="ql-label">Analytics</span>
                      <span className="ql-desc">Product impact metrics</span>
                    </Link>
                  </div>
                </div>

                {/* Significant PRs for Artifacts */}
                {computedStats.significantPRs.length > 0 && (
                  <div className="significant-prs">
                    <h3>🌟 Notable Contributions (Auto-detected)</h3>
                    <p className="sig-hint">Feature PRs and refactors that may be good artifacts</p>
                    <div className="sig-pr-list">
                      {computedStats.significantPRs.map((pr, idx) => (
                        <div key={idx} className="sig-pr-item">
                          <a 
                            href={pr.html_url || pr.web_url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="sig-pr-title"
                          >
                            {pr.title}
                          </a>
                          <span className="sig-pr-source">
                            {pr.html_url ? 'GitHub' : 'GitLab'}
                          </span>
                          <button 
                            className="add-artifact-quick"
                            onClick={() => {
                              setNewArtifact({
                                title: pr.title,
                                url: pr.html_url || pr.web_url,
                                type: 'code',
                                description: ''
                              });
                              setActiveTab('artifacts');
                            }}
                          >
                            + Add as Artifact
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* How to Use Section */}
                <div className="how-to-use">
                  <h3>💡 Using This Data for Promotion</h3>
                  <ul>
                    <li><strong>Quantifiable metrics:</strong> Use the numbers above in your self-assessment</li>
                    <li><strong>PRs page:</strong> Find specific PRs to link as artifacts (design docs, complex features)</li>
                    <li><strong>Issues page:</strong> Reference epics and stories you led or completed</li>
                    <li><strong>Projects page:</strong> Find high-impact projects to highlight</li>
                    <li><strong>Analytics page:</strong> Get business impact data (user engagement, clicks, etc.)</li>
                  </ul>
                </div>
              </>
            ) : (
              <div className="error-state">Failed to load dashboard data. Try refreshing.</div>
            )}
          </div>
        )}

        {activeTab === 'proficiency' && (
          <div className="checklist-tab">
            <div className="tab-header">
              <h2>⚡ P3 Proficiency Requirements</h2>
              <p>These define the "HOW" - the level of work complexity expected at P3</p>
              <div className="section-progress">
                <span>{proficiencyProgress.checked} of {proficiencyProgress.total} complete</span>
                <div className="mini-progress">
                  <div className="mini-fill" style={{ width: `${proficiencyProgress.percent}%` }} />
                </div>
              </div>
            </div>
            <div className="checklist">
              {P3_REQUIREMENTS.proficiency.map(renderChecklistItem)}
            </div>

            <div className="comparison-section">
              <h3>📊 P2 vs P3 Comparison</h3>
              <table className="comparison-table">
                <thead>
                  <tr>
                    <th>Aspect</th>
                    <th>P2 - Software Engineer II</th>
                    <th>P3 - Sr Software Engineer</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Bug Complexity</td>
                    <td>Fixing medium complexity bugs</td>
                    <td className="highlight">Fixing high complexity bugs</td>
                  </tr>
                  <tr>
                    <td>Work Scope</td>
                    <td>Implementing stories</td>
                    <td className="highlight">Implementing epics and larger features</td>
                  </tr>
                  <tr>
                    <td>Code Review</td>
                    <td>Reviewing PRs for epics and larger features</td>
                    <td className="highlight">Reviewing architectural designs and solutions</td>
                  </tr>
                  <tr>
                    <td>Team Coordination</td>
                    <td>—</td>
                    <td className="highlight">Coordinating work among team members</td>
                  </tr>
                  <tr>
                    <td>Design Work</td>
                    <td>End-to-end low level designs</td>
                    <td className="highlight">End-to-end high level designs</td>
                  </tr>
                  <tr>
                    <td>Team Leadership</td>
                    <td>Works on cross-functional teams</td>
                    <td className="highlight">Leads small teams on cross-functional projects</td>
                  </tr>
                  <tr>
                    <td>Min Experience</td>
                    <td>3 years</td>
                    <td className="highlight">5 years</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'experience' && (
          <div className="experience-tab">
            <div className="tab-header">
              <h2>P2 → P3 Enabling Experiences</h2>
              <p>Each requirement below is backed by evidence from your dashboard data</p>
            </div>

            {/* Experience Requirements with Evidence */}
            <div className="experience-evidence-list">
              {/* 1. High Level Designs */}
              <div className="evidence-card">
                <div className="evidence-header">
                  <span className="evidence-number">1</span>
                  <div className="evidence-title">
                    <h3>Develops end-to-end high level designs</h3>
                    <p>Create comprehensive technical designs that span multiple components or systems</p>
                  </div>
                </div>
                <div className="evidence-content">
                  <div className="evidence-data">
                    <span className="evidence-label">From Manager Review:</span>
                    <p>"ViewThatFits dynamic rendering solution", "Solved complex architecture challenges with sCore and Fitt integrations"</p>
                  </div>
                  <div className="evidence-link">
                    <Link to={`/prs${queryString}`}>View Design PRs →</Link>
                  </div>
                </div>
              </div>

              {/* 2. Business & Leadership */}
              <div className="evidence-card">
                <div className="evidence-header">
                  <span className="evidence-number">2</span>
                  <div className="evidence-title">
                    <h3>Initiative to learn business processes and leadership</h3>
                    <p>Applied learning of additional skills around business processes and leadership</p>
                  </div>
                </div>
                <div className="evidence-content">
                  <div className="evidence-data">
                    <span className="evidence-label">From Manager Review:</span>
                    <p>"De facto leader", "Squad lead in all but title", "Structured mentorship for engineers across multiple levels (P1–P4)"</p>
                  </div>
                </div>
              </div>

              {/* 3. Business Areas */}
              <div className="evidence-card">
                <div className="evidence-header">
                  <span className="evidence-number">3</span>
                  <div className="evidence-title">
                    <h3>Familiarity with variety of business areas</h3>
                    <p>Develop knowledge across multiple product and industry areas</p>
                  </div>
                </div>
                <div className="evidence-content">
                  <div className="evidence-metrics">
                    {computedStats && (
                      <>
                        <div className="mini-metric">
                          <span className="mini-value">{computedStats.projectsCount}</span>
                          <span className="mini-label">Projects</span>
                        </div>
                        <div className="mini-metric">
                          <span className="mini-value">{computedStats.reposCount}</span>
                          <span className="mini-label">Repositories</span>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="evidence-data">
                    <span className="evidence-label">From Manager Review:</span>
                    <p>"Betting SME", "Primary go-to domain expert in betting on web"</p>
                  </div>
                  <div className="evidence-link">
                    <Link to={`/projects${queryString}`}>View Projects →</Link>
                  </div>
                </div>
              </div>

              {/* 4. Cross-Technical Collaboration */}
              <div className="evidence-card">
                <div className="evidence-header">
                  <span className="evidence-number">4</span>
                  <div className="evidence-title">
                    <h3>Collaborates across technical areas</h3>
                    <p>Work effectively across product, application, and systems teams</p>
                  </div>
                </div>
                <div className="evidence-content">
                  <div className="evidence-metrics">
                    {computedStats && (
                      <div className="mini-metric">
                        <span className="mini-value">{computedStats.reposCount}</span>
                        <span className="mini-label">Repos Touched</span>
                      </div>
                    )}
                  </div>
                  <div className="evidence-data">
                    <span className="evidence-label">From Manager Review:</span>
                    <p>"Cross-team discussions to identify issues", "Ready to take on larger cross-squad technical initiatives"</p>
                  </div>
                </div>
              </div>

              {/* 5. Leads Small Teams */}
              <div className="evidence-card">
                <div className="evidence-header">
                  <span className="evidence-number">5</span>
                  <div className="evidence-title">
                    <h3>Leads small teams on cross-functional projects</h3>
                    <p>Lead small teams and work on cross-functional teams to deliver projects</p>
                  </div>
                </div>
                <div className="evidence-content">
                  <div className="evidence-data">
                    <span className="evidence-label">Projects Led:</span>
                    <p>MyBets 1.0, MyBets Next Gen Gamecast, Odds Strip 1.1, Bet Carousel</p>
                  </div>
                  <div className="evidence-data">
                    <span className="evidence-label">From Manager Review:</span>
                    <p>"Has stepped up and become a de facto leader", "Moves quickly on complex tasks with high ownership"</p>
                  </div>
                </div>
              </div>

              {/* 6. Autonomously Develops Plans */}
              <div className="evidence-card">
                <div className="evidence-header">
                  <span className="evidence-number">6</span>
                  <div className="evidence-title">
                    <h3>Autonomously develops plans of action</h3>
                    <p>Independently articulate plans, activities, and tasks associated with delivery</p>
                  </div>
                </div>
                <div className="evidence-content">
                  <div className="evidence-metrics">
                    <div className="mini-metric highlight">
                      <span className="mini-value">154</span>
                      <span className="mini-label">JIRA Tickets Created</span>
                    </div>
                  </div>
                  <div className="evidence-data">
                    <span className="evidence-label">From Manager Review:</span>
                    <p>"Took initiative in scoping, creating 154 tickets in JIRA, proactively breaking down requirements and enabling team execution"</p>
                  </div>
                  <div className="evidence-link">
                    <Link to={`/issues${queryString}`}>View Issues →</Link>
                  </div>
                </div>
              </div>

              {/* 7. Delivers Projects */}
              <div className="evidence-card">
                <div className="evidence-header">
                  <span className="evidence-number">7</span>
                  <div className="evidence-title">
                    <h3>Autonomously delivers projects of increasing scope</h3>
                    <p>Handle increasingly complex projects with minimal oversight</p>
                  </div>
                </div>
                <div className="evidence-content">
                  <div className="evidence-metrics">
                    {computedStats && (
                      <>
                        <div className="mini-metric">
                          <span className="mini-value">{computedStats.mergedPRs}</span>
                          <span className="mini-label">PRs Merged</span>
                        </div>
                        <div className="mini-metric">
                          <span className="mini-value">{computedStats.resolvedIssues}</span>
                          <span className="mini-label">Issues Resolved</span>
                        </div>
                        <div className="mini-metric highlight">
                          <span className="mini-value">+79%</span>
                          <span className="mini-label">Velocity vs Team</span>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="evidence-data">
                    <span className="evidence-label">Business Impact:</span>
                    <p>144% user engagement growth post-launch (9.5K → 23K weekly users)</p>
                  </div>
                </div>
              </div>

              {/* 8. Communication */}
              <div className="evidence-card">
                <div className="evidence-header">
                  <span className="evidence-number">8</span>
                  <div className="evidence-title">
                    <h3>Clearly communicates with constructive approach</h3>
                    <p>Ask inquisitive questions and follow a constructive approach in discussions</p>
                  </div>
                </div>
                <div className="evidence-content">
                  <div className="evidence-metrics">
                    {computedStats && (
                      <>
                        <div className="mini-metric">
                          <span className="mini-value">{computedStats.reviewComments}</span>
                          <span className="mini-label">Code Review Comments</span>
                        </div>
                        <div className="mini-metric highlight">
                          <span className="mini-value">+90%</span>
                          <span className="mini-label">vs Team Avg</span>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="evidence-data">
                    <span className="evidence-label">From Manager Review:</span>
                    <p>"Challenging design and implementation with a 'Is there a better way?' mindset", "Welcomes discussion and feedback"</p>
                  </div>
                </div>
              </div>

              {/* 9. Change Agent */}
              <div className="evidence-card">
                <div className="evidence-header">
                  <span className="evidence-number">9</span>
                  <div className="evidence-title">
                    <h3>Change agent in optimizing service delivery</h3>
                    <p>Demonstrate initiative to improve and enhance how services are delivered</p>
                  </div>
                </div>
                <div className="evidence-content">
                  <div className="evidence-data">
                    <span className="evidence-label">Reusable Solutions Created:</span>
                    <ul className="evidence-list">
                      <li>ViewThatFits dynamic rendering solution</li>
                      <li>Next Gen Gamecast Storybook theme for streamlined testing</li>
                      <li>MobX-ready component templates reducing boilerplate</li>
                      <li>Initiated CJS → ESM conversion for long-term build optimization</li>
                    </ul>
                  </div>
                  <div className="evidence-data">
                    <span className="evidence-label">From Manager Review:</span>
                    <p>"4+ reusable solutions adopted across the squad"</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'documentation' && (
          <div className="checklist-tab">
            <div className="tab-header">
              <h2>📄 Required Documentation</h2>
              <p>Prepare these documents for your promotion package</p>
              <div className="section-progress">
                <span>{docProgress.checked} of {docProgress.total} complete</span>
                <div className="mini-progress">
                  <div className="mini-fill" style={{ width: `${docProgress.percent}%` }} />
                </div>
              </div>
            </div>
            <div className="checklist">
              {P3_REQUIREMENTS.documentation.map(renderChecklistItem)}
            </div>

            <div className="doc-tips">
              <h3>💡 Documentation Tips</h3>
              <ul>
                <li><strong>Measurable Impact:</strong> Include concrete examples with numbers where possible</li>
                <li><strong>Artifacts:</strong> Attach design docs, code submissions, performance data</li>
                <li><strong>Business Need:</strong> Articulate why P3-level work is needed on your team</li>
                <li><strong>Operating at Next Level:</strong> Show consistent P3-level performance, not one-offs</li>
                <li><strong>Max 1 page:</strong> Be concise - quality over quantity</li>
              </ul>
            </div>
          </div>
        )}

        {activeTab === 'artifacts' && (
          <div className="artifacts-tab">
            <div className="tab-header">
              <h2>🗂️ Artifacts & Evidence</h2>
              <p>Collect concrete examples demonstrating your P3 capabilities</p>
            </div>

            <div className="add-artifact-form">
              <h3>Add New Artifact</h3>
              <div className="form-row">
                <div className="form-group">
                  <label>Title</label>
                  <input
                    type="text"
                    value={newArtifact.title}
                    onChange={(e) => setNewArtifact(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="e.g., DraftKings Integration Design Doc"
                  />
                </div>
                <div className="form-group">
                  <label>Type</label>
                  <select
                    value={newArtifact.type}
                    onChange={(e) => setNewArtifact(prev => ({ ...prev, type: e.target.value }))}
                  >
                    <option value="design-doc">Design Document</option>
                    <option value="code">Code Submission / PR</option>
                    <option value="presentation">Presentation</option>
                    <option value="metrics">Metrics / Data</option>
                    <option value="feedback">Feedback / Recognition</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>URL / Link</label>
                  <input
                    type="url"
                    value={newArtifact.url}
                    onChange={(e) => setNewArtifact(prev => ({ ...prev, url: e.target.value }))}
                    placeholder="https://..."
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Description (optional)</label>
                <textarea
                  value={newArtifact.description}
                  onChange={(e) => setNewArtifact(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Brief description of the artifact and its impact..."
                  rows={2}
                />
              </div>
              <button className="add-btn" onClick={addArtifact} disabled={!newArtifact.title || !newArtifact.url}>
                + Add Artifact
              </button>
            </div>

            <div className="artifacts-list">
              <h3>Your Artifacts ({data.artifacts.length})</h3>
              {data.artifacts.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon">📁</span>
                  <p>No artifacts added yet. Start collecting evidence of your P3-level work!</p>
                </div>
              ) : (
                data.artifacts.map(artifact => (
                  <div key={artifact.id} className="artifact-card">
                    <div className="artifact-type">{
                      { 'design-doc': '📐', 'code': '💻', 'presentation': '📊', 'metrics': '📈', 'feedback': '💬', 'other': '📎' }[artifact.type]
                    }</div>
                    <div className="artifact-content">
                      <a href={artifact.url} target="_blank" rel="noopener noreferrer" className="artifact-title">
                        {artifact.title}
                      </a>
                      <span className="artifact-meta">{artifact.type.replace('-', ' ')}</span>
                      {artifact.description && <p className="artifact-desc">{artifact.description}</p>}
                    </div>
                    <button className="remove-btn" onClick={() => removeArtifact(artifact.id)}>×</button>
                  </div>
                ))
              )}
            </div>

            <div className="artifact-suggestions">
              <h3>💡 Suggested Artifacts to Collect</h3>
              <ul>
                <li>Design documents you authored or led</li>
                <li>Complex PRs demonstrating technical leadership</li>
                <li>Architecture diagrams you created</li>
                <li>Performance metrics showing impact of your work</li>
                <li>Slack messages / emails showing cross-team collaboration</li>
                <li>Interview feedback (if you've participated in recruiting)</li>
                <li>Mentorship logs or 1:1 notes with junior engineers</li>
              </ul>
            </div>
          </div>
        )}

      </main>

      <footer className="promo-footer">
        <div className="footer-content">
          <span className="save-indicator">✓ Auto-saved to browser</span>
          <div className="footer-links">
            <a href="https://thewaltdisneycompany.sharepoint.com" target="_blank" rel="noopener noreferrer">
              📋 Airtable Nomination Form
            </a>
            <a href="https://thewaltdisneycompany.sharepoint.com" target="_blank" rel="noopener noreferrer">
              📚 Job Family Framework
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default PromotionPage;

