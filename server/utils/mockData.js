/**
 * Mock data generators for development mode
 * Use ?mock=true query param to enable
 */

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
  generateMockPRsData,
  generateMockMRsData,
  generateMockIssuesData,
  generateMockProjectsData,
  generateMockStatsData
};
