const axios = require('axios');
const { calculatePRStats } = require('../utils/statsHelpers');
const { getDateRange, filterByDateRange } = require('../utils/dateHelpers');

const GITLAB_USERNAME = process.env.GITLAB_USERNAME;
const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
const GITLAB_BASE_URL = process.env.GITLAB_BASE_URL || 'https://gitlab.com';

if (!GITLAB_USERNAME || !GITLAB_TOKEN) {
  console.warn('GitLab credentials not configured. GitLab stats will not be available.');
}

const gitlabApi = axios.create({
  baseURL: `${GITLAB_BASE_URL}/api/v4`,
  headers: {
    'PRIVATE-TOKEN': GITLAB_TOKEN
  },
  timeout: 30000
});

async function getAllMergeRequests() {
  const mrs = [];
  let page = 1;
  let hasMore = true;
  const maxPages = 20;

  while (hasMore && page <= maxPages) {
    try {
      const response = await gitlabApi.get('/merge_requests', {
        params: {
          author_username: GITLAB_USERNAME,
          per_page: 100,
          page: page,
          order_by: 'created_at',
          sort: 'desc',
          state: 'all'
        }
      });

      if (response.data.length === 0) {
        hasMore = false;
      } else {
        mrs.push(...response.data);
        page++;
        if (response.data.length < 100) {
          hasMore = false;
        }
      }
    } catch (error) {
      console.error(`Error fetching GitLab merge requests page ${page}:`, error.message);
      hasMore = false;
    }
  }

  return mrs;
}

async function getMRComments(mr) {
  try {
    const comments = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      try {
        const response = await gitlabApi.get(`/projects/${mr.project_id}/merge_requests/${mr.iid}/notes`, {
          params: {
            per_page: 100,
            page: page
          }
        });

        if (response.data.length === 0) {
          hasMore = false;
        } else {
          const userComments = response.data.filter(comment => 
            comment.author?.username?.toLowerCase() === GITLAB_USERNAME.toLowerCase() &&
            !comment.system
          );
          comments.push(...userComments);
          page++;
          if (response.data.length < 100) {
            hasMore = false;
          }
        }
      } catch (error) {
        console.error(`Error fetching MR comments for ${mr.iid}:`, error.message);
        hasMore = false;
      }
    }

    return comments;
  } catch (error) {
    console.error(`Error fetching MR comments for ${mr.iid}:`, error.message);
    return [];
  }
}

async function getAllMRComments(mrs, dateRange = null) {
  const allComments = [];
  const { filterByDateRange } = require('../utils/dateHelpers');
  
  // Filter MRs to date range first, then fetch comments for those MRs
  const filteredMRs = filterByDateRange(mrs, 'created_at', dateRange);
  const limit = Math.min(filteredMRs.length, 100);
  
  for (let i = 0; i < limit; i++) {
    const mr = filteredMRs[i];
    try {
      const comments = await getMRComments(mr);
      allComments.push(...comments);
      
      // Rate limiting: delay every 20 requests
      if (i % 20 === 0 && i > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error(`Error fetching comments for MR ${mr.iid}:`, error.message);
    }
  }
  
  return allComments;
}

function generateMockData() {
  const mrs = [];
  const comments = [];
  const { DEFAULT_START, DEFAULT_END } = require('../utils/dateHelpers');
  
  let monthIndex = 0;
  let monthIter = new Date(DEFAULT_START);
  const end = new Date(DEFAULT_END);
  const currentMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  
  while (monthIter <= currentMonth) {
    const monthDate = new Date(monthIter.getFullYear(), monthIter.getMonth(), 1);
    const mrsThisMonth = Math.floor(Math.random() * 6) + 2;
    
    for (let j = 0; j < mrsThisMonth; j++) {
      const day = Math.floor(Math.random() * 28) + 1;
      const createdDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
      const mergedDate = new Date(createdDate.getTime() + Math.random() * 5 * 24 * 60 * 60 * 1000);
      
      const state = Math.random() > 0.4 ? 'merged' : (Math.random() > 0.5 ? 'opened' : 'closed');
      
      mrs.push({
        id: `mr-${monthIndex}-${j}`,
        iid: 500 + monthIndex * 10 + j,
        title: `feat: Implement ${['API endpoint', 'database migration', 'UI component', 'test suite', 'bug fix'][Math.floor(Math.random() * 5)]}`,
        state: state,
        created_at: createdDate.toISOString(),
        merged_at: state === 'merged' ? mergedDate.toISOString() : null,
        project_id: Math.floor(Math.random() * 3) + 1,
        references: { full: `group/project-${Math.floor(Math.random() * 3) + 1}` },
        source_branch: `feature/branch-${monthIndex}-${j}`
      });
      
      if (Math.random() > 0.4) {
        const commentCount = Math.floor(Math.random() * 4) + 1;
        for (let k = 0; k < commentCount; k++) {
          const commentDate = new Date(createdDate.getTime() + Math.random() * (mergedDate - createdDate));
          comments.push({
            id: `comment-${monthIndex}-${j}-${k}`,
            created_at: commentDate.toISOString(),
            author: { username: 'mock-user' },
            system: false
          });
        }
      }
    }
    
    monthIndex++;
    monthIter.setMonth(monthIter.getMonth() + 1);
  }
  
  return { mrs, comments };
}

async function getStats(dateRange = null) {
  const hasCredentials = GITLAB_USERNAME && GITLAB_TOKEN && 
                         GITLAB_USERNAME.trim() !== '' && 
                         GITLAB_TOKEN.trim() !== '';
  
  if (!hasCredentials) {
    console.log('⚠️  Using mock GitLab data - credentials not configured');
    const { mrs, comments } = generateMockData();
    const stats = calculatePRStats(mrs, comments, dateRange, {
      mergedField: 'merged_at',
      getState: (mr) => mr.state,
      isMerged: (mr) => mr.state === 'merged',
      isOpen: (mr) => mr.state === 'opened',
      isClosed: (mr) => mr.state === 'closed',
      groupByKey: (mr) => mr.project_id || 'unknown'
    });
    
    return {
      ...stats,
      source: 'gitlab',
      username: 'mock-user',
      isMock: true,
      byProject: stats.grouped,
      mrs: stats.items,
      monthlyMRs: stats.monthlyMRs || [],
      monthlyComments: stats.monthlyComments || [],
      avgMRsPerMonth: stats.avgMRsPerMonth || 0,
      avgCommentsPerMonth: stats.avgCommentsPerMonth || 0
    };
  }

  console.log(`✅ Using real GitLab data for user: ${GITLAB_USERNAME}`);
  const startTime = Date.now();
  try {
    const mrs = await getAllMergeRequests();
    console.log(`✓ Fetched ${mrs.length} MRs in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    
    const comments = await getAllMRComments(mrs, dateRange);
    console.log(`✓ Fetched ${mrs.length} MRs and ${comments.length} comments in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    
    const stats = calculatePRStats(mrs, comments, dateRange, {
      mergedField: 'merged_at',
      getState: (mr) => mr.state,
      isMerged: (mr) => mr.state === 'merged',
      isOpen: (mr) => mr.state === 'opened',
      isClosed: (mr) => mr.state === 'closed',
      groupByKey: (mr) => mr.project_id || 'unknown'
    });
    
    return {
      ...stats,
      source: 'gitlab',
      username: GITLAB_USERNAME,
      isMock: false,
      byProject: stats.grouped,
      mrs: stats.items,
      monthlyMRs: stats.monthlyMRs || [],
      monthlyComments: stats.monthlyComments || [],
      avgMRsPerMonth: stats.avgMRsPerMonth,
      avgCommentsPerMonth: stats.avgCommentsPerMonth
    };
  } catch (error) {
    console.error('❌ Error fetching GitLab stats:', error.message);
    console.error('   Falling back to mock data');
    const { mrs, comments } = generateMockData();
    const stats = calculatePRStats(mrs, comments, dateRange, {
      mergedField: 'merged_at',
      getState: (mr) => mr.state,
      isMerged: (mr) => mr.state === 'merged',
      isOpen: (mr) => mr.state === 'opened',
      isClosed: (mr) => mr.state === 'closed',
      groupByKey: (mr) => mr.project_id || 'unknown'
    });
    
    return {
      ...stats,
      source: 'gitlab',
      username: GITLAB_USERNAME,
      isMock: true,
      error: error.message,
      byProject: stats.grouped,
      mrs: stats.items,
      monthlyMRs: stats.monthlyMRs,
      monthlyComments: stats.monthlyComments,
      avgMRsPerMonth: stats.avgMRsPerMonth,
      avgCommentsPerMonth: stats.avgCommentsPerMonth
    };
  }
}

module.exports = {
  getStats
};
