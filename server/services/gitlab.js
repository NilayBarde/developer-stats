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
  // Check cache for raw MRs (cache for 5 minutes)
  const cache = require('../utils/cache');
  const cacheKey = 'gitlab-all-mrs';
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ GitLab MRs served from cache');
    return cached;
  }
  
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

  // Cache MRs for 5 minutes
  cache.set(cacheKey, mrs, 300);
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
  const { filterByDateRange } = require('../utils/dateHelpers');
  
  // Filter MRs to date range first, then fetch comments for those MRs
  const filteredMRs = filterByDateRange(mrs, 'created_at', dateRange);
  const limit = Math.min(filteredMRs.length, 100);
  const mrsToFetch = filteredMRs.slice(0, limit);
  
  // Fetch comments in parallel batches to speed up
  const batchSize = 15;
  const allComments = [];
  
  for (let i = 0; i < mrsToFetch.length; i += batchSize) {
    const batch = mrsToFetch.slice(i, i + batchSize);
    const commentPromises = batch.map(mr => 
      getMRComments(mr).catch(error => {
        console.error(`Error fetching comments for MR ${mr.iid}:`, error.message);
        return [];
      })
    );
    
    const batchComments = await Promise.all(commentPromises);
    allComments.push(...batchComments.flat());
    
    // Small delay between batches to respect rate limits
    if (i + batchSize < mrsToFetch.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return allComments;
}

async function getStats(dateRange = null) {
  const hasCredentials = GITLAB_USERNAME && GITLAB_TOKEN && 
                         GITLAB_USERNAME.trim() !== '' && 
                         GITLAB_TOKEN.trim() !== '';
  
  if (!hasCredentials) {
    throw new Error('GitLab credentials not configured. Please set GITLAB_USERNAME, GITLAB_TOKEN, and GITLAB_BASE_URL environment variables.');
  }

  // Check cache for stats (cache for 2 minutes)
  const cache = require('../utils/cache');
  const statsCacheKey = `gitlab-stats:${JSON.stringify(dateRange)}`;
  const cachedStats = cache.get(statsCacheKey);
  if (cachedStats) {
    console.log('✓ GitLab stats served from cache');
    return cachedStats;
  }

  try {
    const mrs = await getAllMergeRequests();
    const comments = await getAllMRComments(mrs, dateRange);
    
    const stats = calculatePRStats(mrs, comments, dateRange, {
      mergedField: 'merged_at',
      getState: (mr) => mr.state,
      isMerged: (mr) => mr.state === 'merged',
      isOpen: (mr) => mr.state === 'opened',
      isClosed: (mr) => mr.state === 'closed',
      groupByKey: (mr) => mr.project_id || 'unknown'
    });
    
    const result = {
      ...stats,
      source: 'gitlab',
      username: GITLAB_USERNAME,
      byProject: stats.grouped,
      mrs: stats.items,
      monthlyMRs: stats.monthlyMRs || [],
      monthlyComments: stats.monthlyComments || [],
      avgMRsPerMonth: stats.avgMRsPerMonth,
      avgCommentsPerMonth: stats.avgCommentsPerMonth
    };
    
    // Cache stats for 2 minutes
    cache.set(statsCacheKey, result, 120);
    
    return result;
  } catch (error) {
    console.error('❌ Error fetching GitLab stats:', error.message);
    throw error;
  }
}

module.exports = {
  getStats
};
