/**
 * Mock data generators for development mode
 * Use ?mock=true query param to enable
 */

// Generate mock analytics data for development (avoids API rate limits)
function generateMockAnalyticsData(startDate, endDate, launchDate) {
  const start = startDate || '2025-03-01';
  const end = endDate || new Date().toISOString().split('T')[0];
  const launch = launchDate || '2025-12-01';
  
  // Mock pages with realistic data - includes league and pageType
  const mockPages = [
    { page: 'espn:nfl:game:gamecast', label: 'NFL Gamecast', league: 'NFL', pageType: 'gamecast', baseClicks: 350000 },
    { page: 'espn:nba:game:gamecast', label: 'NBA Gamecast', league: 'NBA', pageType: 'gamecast', baseClicks: 280000 },
    { page: 'espn:mlb:game:gamecast', label: 'MLB Gamecast', league: 'MLB', pageType: 'gamecast', baseClicks: 220000 },
    { page: 'espn:nhl:game:gamecast', label: 'NHL Gamecast', league: 'NHL', pageType: 'gamecast', baseClicks: 150000 },
    { page: 'espn:ncaaf:game:gamecast', label: 'College Football Gamecast', league: 'NCAAF', pageType: 'gamecast', baseClicks: 180000 },
    { page: 'espn:ncaab:game:gamecast', label: 'College Basketball Gamecast', league: 'NCAAB', pageType: 'gamecast', baseClicks: 140000 },
    { page: 'espn:soccer:match:gamecast', label: 'Soccer Gamecast', league: 'Soccer', pageType: 'gamecast', baseClicks: 90000 },
    { page: 'espn:nfl:scoreboard', label: 'NFL Scoreboard', league: 'NFL', pageType: 'scoreboard', baseClicks: 200000 },
    { page: 'espn:nba:scoreboard', label: 'NBA Scoreboard', league: 'NBA', pageType: 'scoreboard', baseClicks: 160000 },
    { page: 'espn:mlb:scoreboard', label: 'MLB Scoreboard', league: 'MLB', pageType: 'scoreboard', baseClicks: 120000 },
    { page: 'espn:nfl:odds', label: 'NFL Odds', league: 'NFL', pageType: 'odds', baseClicks: 180000 },
    { page: 'espn:nba:odds', label: 'NBA Odds', league: 'NBA', pageType: 'odds', baseClicks: 140000 },
    { page: 'espn:mlb:odds', label: 'MLB Odds', league: 'MLB', pageType: 'odds', baseClicks: 100000 },
    { page: 'espn:nfl:schedule', label: 'NFL Schedule', league: 'NFL', pageType: 'schedule', baseClicks: 95000 },
    { page: 'espn:nba:schedule', label: 'NBA Schedule', league: 'NBA', pageType: 'schedule', baseClicks: 75000 },
    // Interstitial (confirmation modal)
    { page: 'espn:betting:interstitial', label: 'Bet Confirmation Modal', league: null, pageType: 'interstitial', baseClicks: 800000, isInterstitial: true },
  ];
  
  // Generate daily data with proper ISO date format
  const generateDailyClicks = (baseClicks, startStr, endStr, launchStr) => {
    const dailyClicks = {};
    const startD = new Date(startStr);
    const endD = new Date(endStr);
    const launchD = new Date(launchStr);
    const days = Math.ceil((endD - startD) / (1000 * 60 * 60 * 24));
    const avgPerDay = Math.round(baseClicks / days);
    
    let beforeTotal = 0, afterTotal = 0;
    let beforeDays = 0, afterDays = 0;
    
    for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
      const variance = 0.5 + Math.random();
      const clicks = Math.round(avgPerDay * variance);
      // Use ISO date format: YYYY-MM-DD
      const dateStr = d.toISOString().split('T')[0];
      dailyClicks[dateStr] = { clicks };
      
      if (d < launchD) {
        beforeTotal += clicks;
        beforeDays++;
      } else {
        afterTotal += clicks;
        afterDays++;
      }
    }
    
    const avgClicksBefore = beforeDays > 0 ? Math.round(beforeTotal / beforeDays) : 0;
    const avgClicksAfter = afterDays > 0 ? Math.round(afterTotal / afterDays) : 0;
    
    // Calculate changePercent with proper edge case handling
    let changePercent = null;
    if (avgClicksBefore > 0) {
      changePercent = Math.round(((avgClicksAfter - avgClicksBefore) / avgClicksBefore) * 100);
    } else if (avgClicksAfter > 0) {
      changePercent = 100;
    }
    
    return {
      dailyClicks,
      comparison: {
        avgClicksBefore,
        avgClicksAfter,
        beforeDays,
        afterDays,
        changePercent
      }
    };
  };
  
  // Build projects
  const projects = mockPages.map(p => {
    const { dailyClicks, comparison } = generateDailyClicks(p.baseClicks, start, end, launch);
    const totalClicks = Object.values(dailyClicks).reduce((sum, d) => sum + d.clicks, 0);
    
    return {
      epicKey: p.page,
      label: p.label,
      pageType: p.pageType,
      league: p.league,
      isInterstitial: p.isInterstitial || false,
      launchDate: launch,
      parentProject: 'SEWEB-59645',
      parentLabel: 'DraftKings Integration',
      metricType: 'betClicks',
      clicks: {
        totalClicks,
        dailyClicks,
        comparison
      }
    };
  });
  
  // Calculate engagement vs interstitial clicks
  const interstitialClicks = projects.filter(p => p.isInterstitial).reduce((sum, p) => sum + p.clicks.totalClicks, 0);
  const engagementClicks = projects.filter(p => !p.isInterstitial).reduce((sum, p) => sum + p.clicks.totalClicks, 0);
  const totalClicks = interstitialClicks + engagementClicks;
  
  // Group by page type
  const pageTypeLabels = {
    'gamecast': 'Gamecast',
    'scoreboard': 'Scoreboard', 
    'odds': 'Odds',
    'schedule': 'Schedule',
    'interstitial': 'Confirmation (Interstitial)',
    'other': 'Other Pages'
  };
  
  const grouped = {};
  projects.forEach(project => {
    const pageType = project.pageType;
    if (!grouped[pageType]) {
      grouped[pageType] = {
        label: pageTypeLabels[pageType] || pageType,
        totalClicks: 0,
        pages: []
      };
    }
    grouped[pageType].totalClicks += project.clicks.totalClicks;
    grouped[pageType].pages.push({
      page: project.epicKey,
      label: project.label,
      league: project.league,
      clicks: project.clicks.totalClicks,
      dailyClicks: project.clicks.dailyClicks,
      comparison: project.clicks.comparison
    });
  });
  
  // Sort pages within each group by clicks
  Object.values(grouped).forEach(group => {
    group.pages.sort((a, b) => b.clicks - a.clicks);
  });
  
  // Build byLeague breakdown
  const byLeague = {};
  projects.filter(p => p.league && !p.isInterstitial).forEach(project => {
    if (!byLeague[project.league]) {
      byLeague[project.league] = { league: project.league, totalClicks: 0, pages: [] };
    }
    byLeague[project.league].totalClicks += project.clicks.totalClicks;
    byLeague[project.league].pages.push(project.label);
  });
  const byLeagueArray = Object.values(byLeague).sort((a, b) => b.totalClicks - a.totalClicks);
  
  // Build byPageType breakdown
  const byPageType = {};
  projects.filter(p => !p.isInterstitial).forEach(project => {
    if (!byPageType[project.pageType]) {
      byPageType[project.pageType] = { pageType: project.pageType, totalClicks: 0, count: 0 };
    }
    byPageType[project.pageType].totalClicks += project.clicks.totalClicks;
    byPageType[project.pageType].count++;
  });
  const byPageTypeArray = Object.values(byPageType).sort((a, b) => b.totalClicks - a.totalClicks);
  
  return {
    projects,
    grouped,
    byLeague: byLeagueArray,
    byPageType: byPageTypeArray,
    method: 'MOCK DATA (mock=true)',
    segmentId: 'mock-segment-id',
    totalClicks,
    engagementClicks,
    interstitialClicks,
    confirmationRate: totalClicks > 0 ? ((interstitialClicks / totalClicks) * 100).toFixed(1) + '%' : '0%',
    totalPages: projects.length,
    dateRange: { start, end },
    launchDate: launch,
    timing: { totalMs: 0, note: 'Mock data - instant', pagesWithDailyData: projects.length }
  };
}

// Generate mock PRs data
function generateMockPRsData() {
  const repos = ['frontend-app', 'backend-api', 'shared-components', 'mobile-app'];
  const authors = ['alice', 'bob', 'charlie', 'diana', 'eve'];
  const states = ['open', 'closed', 'closed']; // More closed than open
  
  const prs = [];
  for (let i = 0; i < 25; i++) {
    const daysAgo = Math.floor(Math.random() * 30);
    const createdDate = new Date();
    createdDate.setDate(createdDate.getDate() - daysAgo);
    const updatedDate = new Date(createdDate);
    updatedDate.setDate(updatedDate.getDate() + Math.floor(Math.random() * 3));
    
    const state = states[i % 3];
    const isMerged = state === 'closed' && i % 2 === 0;
    const repo = repos[i % repos.length];
    
    prs.push({
      id: 1000 + i,
      number: 100 + i,
      title: `[MOCK] ${['Fix', 'Add', 'Update', 'Refactor'][i % 4]} ${['authentication', 'dashboard', 'API endpoint', 'styling', 'tests'][i % 5]}`,
      user: { login: authors[i % authors.length] },
      state: state,
      created_at: createdDate.toISOString(),
      updated_at: updatedDate.toISOString(),
      html_url: `https://github.com/example/${repo}/pull/${100 + i}`,
      repository_url: `https://api.github.com/repos/example/${repo}`,
      pull_request: isMerged ? { merged_at: updatedDate.toISOString() } : {},
      additions: Math.floor(Math.random() * 500),
      deletions: Math.floor(Math.random() * 200),
      comments: Math.floor(Math.random() * 10)
    });
  }
  
  return { prs, baseUrl: 'https://github.com', mock: true };
}

// Generate mock MRs data
function generateMockMRsData() {
  const projects = ['web-platform', 'data-service', 'analytics-engine'];
  const authors = ['alice', 'bob', 'charlie'];
  const states = ['merged', 'opened', 'closed'];
  
  const mrs = [];
  for (let i = 0; i < 15; i++) {
    const daysAgo = Math.floor(Math.random() * 30);
    const createdDate = new Date();
    createdDate.setDate(createdDate.getDate() - daysAgo);
    const updatedDate = new Date(createdDate);
    updatedDate.setDate(updatedDate.getDate() + Math.floor(Math.random() * 3));
    
    const state = states[i % 3];
    const project = projects[i % projects.length];
    
    mrs.push({
      id: 2000 + i,
      iid: 50 + i,
      title: `[MOCK] ${['Implement', 'Fix', 'Update'][i % 3]} ${['feature', 'bug', 'config'][i % 3]}`,
      author: { username: authors[i % authors.length] },
      project_id: project,
      state: state,
      created_at: createdDate.toISOString(),
      updated_at: updatedDate.toISOString(),
      merged_at: state === 'merged' ? updatedDate.toISOString() : null,
      web_url: `https://gitlab.com/example/${project}/-/merge_requests/${50 + i}`
    });
  }
  
  return { mrs, baseUrl: 'https://gitlab.com', mock: true };
}

// Generate mock Issues data
function generateMockIssuesData() {
  const projectKeys = ['PROJ', 'FEAT', 'BUG'];
  const types = ['Story', 'Bug', 'Task', 'Sub-task'];
  const statuses = ['Done', 'In Progress', 'To Do', 'In Review'];
  const priorities = ['High', 'Medium', 'Low'];
  const assignees = ['Alice Smith', 'Bob Jones', 'Charlie Brown', 'Diana Prince'];
  
  const issues = [];
  for (let i = 0; i < 30; i++) {
    const daysAgo = Math.floor(Math.random() * 60);
    const createdDate = new Date();
    createdDate.setDate(createdDate.getDate() - daysAgo);
    const updatedDate = new Date(createdDate);
    updatedDate.setDate(updatedDate.getDate() + Math.floor(Math.random() * 10));
    
    const status = statuses[i % statuses.length];
    const projectKey = projectKeys[i % projectKeys.length];
    const isDone = status === 'Done';
    
    issues.push({
      key: `${projectKey}-${100 + i}`,
      id: `${3000 + i}`,
      fields: {
        summary: `[MOCK] ${['Implement', 'Fix', 'Update', 'Add', 'Remove'][i % 5]} ${['login flow', 'dashboard widget', 'API response', 'unit tests', 'documentation'][i % 5]}`,
        issuetype: { name: types[i % types.length] },
        status: { name: status },
        priority: { name: priorities[i % priorities.length] },
        assignee: { displayName: assignees[i % assignees.length] },
        reporter: { displayName: assignees[(i + 1) % assignees.length] },
        project: { key: projectKey, name: `Project ${projectKey}` },
        created: createdDate.toISOString(),
        updated: updatedDate.toISOString(),
        resolutiondate: isDone ? updatedDate.toISOString() : null,
        customfield_10106: [1, 2, 3, 5, 8][i % 5] // Story points
      },
      _sprintName: `Sprint ${Math.floor(i / 5) + 1}`,
      _inProgressDate: new Date(createdDate.getTime() + 24 * 60 * 60 * 1000).toISOString()
    });
  }
  
  return { issues, baseUrl: 'https://jira.example.com', mock: true };
}

// Generate mock Projects data
function generateMockProjectsData() {
  const epicData = [
    { epicKey: 'PROJ-100', epicName: '[MOCK] User Authentication Revamp', project: 'PROJ' },
    { epicKey: 'PROJ-101', epicName: '[MOCK] Dashboard Redesign', project: 'PROJ' },
    { epicKey: 'PROJ-102', epicName: '[MOCK] API Performance Optimization', project: 'PROJ' },
    { epicKey: 'FEAT-50', epicName: '[MOCK] Mobile App Launch', project: 'FEAT' },
    { epicKey: 'FEAT-51', epicName: '[MOCK] Analytics Integration', project: 'FEAT' },
  ];
  
  const issueTypes = ['Story', 'Bug', 'Task', 'Sub-task'];
  const statuses = ['Done', 'In Progress', 'To Do', 'In Review'];
  
  const epics = epicData.map((e, i) => {
    const epicTotalPoints = 20 + Math.floor(Math.random() * 50);
    const userTotalPointsAllTime = Math.floor(epicTotalPoints * (0.2 + Math.random() * 0.4));
    const epicTotalIssues = 5 + Math.floor(Math.random() * 15);
    const userTotalIssuesAllTime = Math.floor(epicTotalIssues * (0.2 + Math.random() * 0.4));
    const totalDoneIssues = Math.floor(userTotalIssuesAllTime * 0.6);
    const storyPointsCompleted = Math.floor(userTotalPointsAllTime * 0.6);
    
    // Generate issue type breakdown
    const issueTypeBreakdown = {};
    const typeCount = 2 + Math.floor(Math.random() * 3);
    for (let t = 0; t < typeCount; t++) {
      const type = issueTypes[t % issueTypes.length];
      issueTypeBreakdown[type] = 1 + Math.floor(Math.random() * 5);
    }
    
    // Generate mock issues for this epic
    const issues = [];
    const numIssues = userTotalIssuesAllTime || 3;
    for (let j = 0; j < numIssues; j++) {
      issues.push({
        key: `${e.project}-${100 + i * 10 + j}`,
        summary: `[MOCK] Issue ${j + 1} for ${e.epicName}`,
        storyPoints: [1, 2, 3, 5, 8][j % 5],
        status: statuses[j % statuses.length]
      });
    }
    
    return {
      ...e,
      issueTypeBreakdown,
      issues,
      metrics: {
        epicTotalPoints,
        epicTotalIssues,
        userTotalPointsAllTime,
        userTotalIssuesAllTime,
        totalDoneIssues,
        storyPointsCompleted,
        totalIssues: userTotalIssuesAllTime,
        remainingStoryPoints: userTotalPointsAllTime - storyPointsCompleted,
      }
    };
  });
  
  const issuesWithoutEpicList = [
    { key: 'MISC-1', summary: '[MOCK] Quick fix', storyPoints: 1, status: 'Done' },
    { key: 'MISC-2', summary: '[MOCK] Documentation update', storyPoints: 2, status: 'In Progress' },
  ];
  
  return {
    epics,
    totalEpics: epics.length,
    issuesWithoutEpic: issuesWithoutEpicList.length,
    issuesWithoutEpicList,
    baseUrl: 'https://jira.example.com',
    mock: true
  };
}

// Generate mock stats data for the dashboard
function generateMockStatsData() {
  const repos = ['frontend-app', 'backend-api', 'shared-components', 'mobile-app'];
  const projects = ['PROJ', 'FEAT', 'BUG'];
  
  // Generate monthly data for the past 6 months
  const monthlyPRs = [];
  const monthlyMRs = [];
  const monthlyIssues = [];
  const now = new Date();
  
  for (let i = 5; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    monthlyPRs.push({ month: monthKey, count: 3 + Math.floor(Math.random() * 8) });
    monthlyMRs.push({ month: monthKey, count: 2 + Math.floor(Math.random() * 5) });
    monthlyIssues.push({ month: monthKey, count: 5 + Math.floor(Math.random() * 10) });
  }
  
  // Generate mock GitHub stats
  const github = {
    source: 'github',
    username: 'mock-user',
    total: 25,
    merged: 20,
    open: 3,
    closed: 2,
    last30Days: 8,
    avgPRsPerMonth: 4.2,
    monthlyPRs,
    byRepository: repos.reduce((acc, repo) => {
      acc[repo] = { total: 5 + Math.floor(Math.random() * 5), merged: 4 + Math.floor(Math.random() * 3) };
      return acc;
    }, {}),
    grouped: repos.reduce((acc, repo) => {
      acc[repo] = { total: 5 + Math.floor(Math.random() * 5), merged: 4 + Math.floor(Math.random() * 3) };
      return acc;
    }, {}),
    prs: [],
    mock: true
  };
  
  // Generate mock GitLab stats
  const gitlab = {
    source: 'gitlab',
    username: 'mock-user',
    total: 15,
    merged: 12,
    open: 2,
    closed: 1,
    last30Days: 5,
    avgMRsPerMonth: 2.5,
    monthlyMRs,
    byRepository: {
      'web-platform': { total: 8, merged: 7 },
      'data-service': { total: 4, merged: 3 },
      'analytics-engine': { total: 3, merged: 2 }
    },
    grouped: {
      'web-platform': { total: 8, merged: 7 },
      'data-service': { total: 4, merged: 3 },
      'analytics-engine': { total: 3, merged: 2 }
    },
    mrs: [],
    mock: true
  };
  
  // Generate mock Jira stats
  const jira = {
    source: 'jira',
    email: 'mock-user@example.com',
    baseUrl: 'https://jira.example.com',
    total: 30,
    resolved: 22,
    inProgress: 5,
    done: 22,
    last30Days: 12,
    avgResolutionTime: 3.5,
    avgResolutionTimeCount: 15,
    totalStoryPoints: 89,
    avgIssuesPerMonth: 5,
    monthlyIssues,
    byType: {
      'Story': 12,
      'Bug': 8,
      'Task': 7,
      'Sub-task': 3
    },
    byProject: projects.reduce((acc, proj) => {
      acc[proj] = { total: 8 + Math.floor(Math.random() * 5), done: 5 + Math.floor(Math.random() * 3) };
      return acc;
    }, {}),
    velocity: {
      averageVelocity: 21,
      combinedAverageVelocity: 21,
      totalSprints: 6,
      sprints: [],
      byBoard: {}
    },
    issues: [
      { 
        key: 'PROJ-101', 
        fields: { 
          summary: '[MOCK] Fix login flow', 
          status: { name: 'Done' }, 
          issuetype: { name: 'Story' },
          updated: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
          created: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
          resolutiondate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
        }
      },
      { 
        key: 'PROJ-102', 
        fields: { 
          summary: '[MOCK] Add dashboard widget', 
          status: { name: 'In Progress' }, 
          issuetype: { name: 'Task' },
          updated: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
          created: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
        }
      },
      { 
        key: 'FEAT-51', 
        fields: { 
          summary: '[MOCK] Analytics integration', 
          status: { name: 'In Review' }, 
          issuetype: { name: 'Story' },
          updated: new Date().toISOString(),
          created: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        }
      }
    ],
    mock: true
  };
  
  return {
    github,
    gitlab,
    jira,
    timestamp: new Date().toISOString(),
    mock: true
  };
}

module.exports = {
  generateMockAnalyticsData,
  generateMockPRsData,
  generateMockMRsData,
  generateMockIssuesData,
  generateMockProjectsData,
  generateMockStatsData
};

