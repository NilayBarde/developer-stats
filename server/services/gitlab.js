const axios = require('axios');
const cache = require('../utils/cache');
const { calculatePRStats } = require('../utils/statsHelpers');
const { prepareItemsForPage } = require('../utils/serviceHelpers');

const GITLAB_USERNAME = process.env.GITLAB_USERNAME;
const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
const GITLAB_BASE_URL = process.env.GITLAB_BASE_URL || 'https://gitlab.com';

if (!GITLAB_USERNAME || !GITLAB_TOKEN) {
  console.warn('GitLab credentials not configured. GitLab stats will not be available.');
}

// API clients
const gitlabApi = axios.create({
  baseURL: `${GITLAB_BASE_URL}/api/v4`,
  headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN },
  timeout: 30000
});

const gitlabGraphQL = axios.create({
  baseURL: `${GITLAB_BASE_URL}/api`,
  headers: { 
    'Authorization': `Bearer ${GITLAB_TOKEN}`,
    'Content-Type': 'application/json'
  },
  timeout: 30000
});

// ============================================================================
// GraphQL Helpers
// ============================================================================

async function graphqlQuery(query, variables = {}) {
  const response = await gitlabGraphQL.post('/graphql', { query, variables });
  if (response.data.errors) {
    throw new Error(`GraphQL error: ${response.data.errors[0]?.message}`);
  }
  return response.data.data;
}

const AUTHORED_MRS_QUERY = `
  query getAuthoredMRs($cursor: String) {
    currentUser {
      authoredMergeRequests(first: 100, after: $cursor, state: all) {
        nodes {
          id
          iid
          title
          state
          createdAt
          updatedAt
          mergedAt
          webUrl
          project {
            id
            fullPath
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

// ============================================================================
// Constants
// ============================================================================

const GITLAB_ACTIONS = ['commented', 'created', 'merged', 'approved'];

// ============================================================================
// Core Data Fetching
// ============================================================================

/**
 * Get current user ID from GitLab (needed for Events API)
 */
async function getCurrentUserId() {
  const cacheKey = 'gitlab-user-id';
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const response = await gitlabApi.get('/user');
    const userId = response.data.id;
    cache.set(cacheKey, userId, 3600); // Cache for 1 hour
    return userId;
  } catch (error) {
    console.error('Failed to get GitLab user ID:', error.message);
    return null;
  }
}

/**
 * Fetch events by action type using Events API (matches engineering-metrics)
 * Actions: commented, created, merged, approved
 */
async function getEventsByAction(action, dateRange = null) {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const events = [];
  let page = 1;
  const maxPages = 10; // Limit pagination

  // Build date params
  const params = { action, per_page: 100 };
  if (dateRange?.start) params.after = dateRange.start;
  if (dateRange?.end) params.before = dateRange.end;

  while (page <= maxPages) {
    try {
      const response = await gitlabApi.get(`/users/${userId}/events`, {
        params: { ...params, page }
      });

      // Stop only when we get an empty page (GitLab may return < 100 but still have more pages)
      if (response.data.length === 0) break;
      events.push(...response.data);
      page++;
    } catch (error) {
      console.error(`  Events API error for action ${action}:`, error.message);
      break;
    }
  }

  return events;
}

/**
 * Get action stats using Events API (matches engineering-metrics format)
 * Returns: { commented, created, merged, approved }
 */
async function getActionStats(dateRange = null) {
  const cacheKey = `gitlab-actions:v1:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ GitLab action stats served from cache');
    return cached;
  }

  console.log('🔷 Fetching GitLab action stats via Events API...');
  const startTime = Date.now();

  // Fetch all actions in parallel
  const [commentedEvents, createdEvents, mergedEvents, approvedEvents] = await Promise.all([
    getEventsByAction('commented', dateRange),
    getEventsByAction('created', dateRange),
    getEventsByAction('merged', dateRange),
    getEventsByAction('approved', dateRange)
  ]);

  const result = {
    commented: commentedEvents.length,
    created: createdEvents.length,
    merged: mergedEvents.length,
    approved: approvedEvents.length
  };

  cache.set(cacheKey, result, 300);
  console.log(`  ✓ Actions: commented=${result.commented}, created=${result.created}, merged=${result.merged}, approved=${result.approved} (${Date.now() - startTime}ms)`);

  return result;
}

/**
 * Fetch all MRs authored by user via GraphQL
 */
async function getAllMergeRequests() {
  const cacheKey = 'gitlab-mrs:v3';
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ GitLab MRs served from cache');
    return cached;
  }

  const startTime = Date.now();
  console.log('🔷 Fetching GitLab MRs via GraphQL...');

  const allMRs = [];
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
    const data = await graphqlQuery(AUTHORED_MRS_QUERY, { cursor });
    const connection = data.currentUser?.authoredMergeRequests;
    
    if (!connection?.nodes) break;

    for (const mr of connection.nodes) {
      allMRs.push({
        id: mr.id,
        iid: mr.iid,
        title: mr.title,
        state: mr.state?.toLowerCase(),
        created_at: mr.createdAt,
        updated_at: mr.updatedAt,
        merged_at: mr.mergedAt,
        web_url: mr.webUrl,
        project_id: mr.project?.id?.replace('gid://gitlab/Project/', ''),
        _projectPath: mr.project?.fullPath
      });
    }

    hasNextPage = connection.pageInfo.hasNextPage;
    cursor = connection.pageInfo.endCursor;
  }

  console.log(`  ✓ Found ${allMRs.length} MRs (${Date.now() - startTime}ms)`);
  cache.set(cacheKey, allMRs, 300);
  return allMRs;
}

/**
 * Fetch project names for given IDs (used by getReviewComments)
 */
async function getProjectNames(projectIds) {
  const projectNamesMap = new Map();
  const uniqueIds = [...new Set(projectIds.filter(id => id && id !== 'unknown'))];
  
  if (uniqueIds.length === 0) return projectNamesMap;
  
  // Check cache first
  const idsToFetch = [];
  for (const id of uniqueIds) {
    const cached = cache.get(`gitlab-project:${id}`);
    if (cached) {
      projectNamesMap.set(id.toString(), cached);
    } else {
      idsToFetch.push(id);
    }
  }
  
  if (idsToFetch.length > 0) {
    console.log(`🔷 Fetching ${idsToFetch.length} project names...`);
    
    // Batch fetch in parallel
    const results = await Promise.all(
      idsToFetch.map(async (projectId) => {
        try {
          const response = await gitlabApi.get(`/projects/${projectId}`, { params: { simple: true } });
          const name = response.data.path_with_namespace || response.data.name || projectId.toString();
          cache.set(`gitlab-project:${projectId}`, name, 3600);
          return { id: projectId, name };
        } catch {
          cache.set(`gitlab-project:${projectId}`, projectId.toString(), 3600);
          return { id: projectId, name: projectId.toString() };
        }
      })
    );
    
    results.forEach(({ id, name }) => projectNamesMap.set(id.toString(), name));
  }
  
  return projectNamesMap;
}

// ============================================================================
// Stats & API Functions
// ============================================================================

/**
 * Get GitLab stats using Events API to match engineering-metrics format
 * Primary metrics: commented, created, merged, approved
 * Also includes MR details for monthly breakdown and dashboard compatibility
 */
async function getStats(dateRange = null) {
  if (!GITLAB_USERNAME || !GITLAB_TOKEN) {
    throw new Error('GitLab credentials not configured');
  }

  const cacheKey = `gitlab-stats:v5:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ GitLab stats served from cache');
    return cached;
  }

  // Fetch both Events API (for engineering-metrics alignment) AND MR details (for monthly breakdown)
  const [actionStats, mrs] = await Promise.all([
    getActionStats(dateRange),
    getAllMergeRequests()
  ]);

  // Calculate MR stats for monthly data and dashboard compatibility
  const mrStats = calculatePRStats(mrs, [], dateRange, {
    mergedField: 'merged_at',
    getState: (mr) => mr.state,
    isMerged: (mr) => mr.state === 'merged',
    isOpen: (mr) => mr.state === 'opened',
    isClosed: (mr) => mr.state === 'closed',
    groupByKey: (mr) => mr._projectPath || 'unknown'
  });

  const result = {
    source: 'gitlab',
    username: GITLAB_USERNAME,
    // Primary metrics matching engineering-metrics format
    commented: actionStats.commented,
    created: actionStats.created,
    merged: actionStats.merged,
    approved: actionStats.approved,
    // Legacy/dashboard fields for backwards compatibility
    total: mrStats.total,
    avgMRsPerMonth: mrStats.avgMRsPerMonth,
    monthlyMRs: mrStats.monthlyMRs,
    monthlyMerged: mrStats.monthlyMerged,
    reposAuthored: mrStats.reposAuthored,
    repoBreakdown: mrStats.repoBreakdown,
    byProject: mrStats.grouped,
    mrs: mrStats.items
  };
  
  cache.set(cacheKey, result, 300);
  return result;
}

/**
 * Get all MRs for the MRs page with date filtering
 */
async function getAllMRsForPage(dateRange = null) {
  const mrs = await getAllMergeRequests();
  const transformFn = (mr) => ({ ...mr, _projectName: mr._projectPath || 'unknown' });
  return prepareItemsForPage(mrs, dateRange, transformFn);
}

/**
 * Fetch comments made by user on MRs
 * Uses Events API + reviewer MRs + own MRs to find all commented MRs
 */
async function getReviewComments(dateRange = null) {
  if (!GITLAB_USERNAME || !GITLAB_TOKEN) {
    return { totalComments: 0, mrsReviewed: 0, avgCommentsPerMR: 0, avgReviewsPerMonth: 0, byRepo: [], monthlyComments: {} };
  }

  const cacheKey = `gitlab-comments:v3:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ GitLab comments served from cache');
    return cached;
  }

  const startTime = Date.now();
  console.log('🔷 Fetching GitLab comments...');
  
  const mrsToCheck = new Map();
  
  // Step 1: Events API - tells us which MRs user commented on
  console.log('  → Fetching comment events...');
  let eventsPage = 1;
  while (eventsPage <= 100) {
    try {
      const response = await gitlabApi.get('/events', {
        params: { action: 'commented', per_page: 100, page: eventsPage }
      });
      
      if (response.data.length === 0) break;
      
      for (const event of response.data) {
        if (event.target_type === 'MergeRequest' && event.project_id && event.target_iid) {
          const key = `${event.project_id}-${event.target_iid}`;
          if (!mrsToCheck.has(key)) {
            mrsToCheck.set(key, {
              project_id: event.project_id,
              iid: event.target_iid,
              title: event.target_title
            });
          }
        }
      }
      
      if (response.data.length < 100) break;
      eventsPage++;
    } catch (error) {
      console.error('  Events API error:', error.message);
      break;
    }
  }
  console.log(`    Found ${mrsToCheck.size} MRs from events`);
  
  // Step 2: Reviewer MRs
  console.log('  → Fetching reviewer MRs...');
  let reviewerPage = 1;
  while (reviewerPage <= 50) {
    try {
      const response = await gitlabApi.get('/merge_requests', {
        params: { reviewer_username: GITLAB_USERNAME, state: 'all', per_page: 100, page: reviewerPage, scope: 'all' }
      });
      
      if (response.data.length === 0) break;
      
      for (const mr of response.data) {
        const key = `${mr.project_id}-${mr.iid}`;
        if (!mrsToCheck.has(key)) {
          mrsToCheck.set(key, mr);
        }
      }
      
      if (response.data.length < 100) break;
      reviewerPage++;
    } catch (error) {
      console.error('  Reviewer MRs error:', error.message);
      break;
    }
  }
  
  // Step 3: Own MRs
  const ownMRs = await getAllMergeRequests();
  for (const mr of ownMRs) {
    const key = `${mr.project_id}-${mr.iid}`;
    if (!mrsToCheck.has(key)) {
      mrsToCheck.set(key, mr);
    }
  }
  
  console.log(`  → Checking notes on ${mrsToCheck.size} MRs...`);
  
  // Fetch notes and count comments
  const commentsByMonth = new Map();
  const commentsByRepo = new Map();
  let totalComments = 0;
  let mrsWithComments = 0;
  
  const mrsArray = Array.from(mrsToCheck.values());
  const batchSize = 50;
  
  for (let i = 0; i < mrsArray.length; i += batchSize) {
    const batch = mrsArray.slice(i, i + batchSize);
    
    await Promise.all(batch.map(async (mr) => {
      const mrCacheKey = `gitlab-notes:${mr.project_id}-${mr.iid}`;
      let userNotes = cache.get(mrCacheKey);
      
      if (!userNotes) {
        try {
          const response = await gitlabApi.get(
            `/projects/${mr.project_id}/merge_requests/${mr.iid}/notes`,
            { params: { per_page: 100 } }
          );
          userNotes = (response.data || []).filter(note => 
            note.author?.username === GITLAB_USERNAME && !note.system
          );
          cache.set(mrCacheKey, userNotes, 600);
        } catch {
          userNotes = [];
        }
      }
      
      // Apply date filter
      const validNotes = userNotes.filter(note => {
        if (!dateRange?.start && !dateRange?.end) return true;
        const noteDate = new Date(note.created_at);
        if (dateRange.start && noteDate < new Date(dateRange.start)) return false;
        if (dateRange.end && noteDate > new Date(dateRange.end)) return false;
        return true;
      });
      
      if (validNotes.length > 0) {
        mrsWithComments++;
        totalComments += validNotes.length;
        
        for (const note of validNotes) {
          const month = note.created_at?.substring(0, 7) || 'unknown';
          commentsByMonth.set(month, (commentsByMonth.get(month) || 0) + 1);
        }
        
        const projectId = mr.project_id?.toString() || 'unknown';
        if (!commentsByRepo.has(projectId)) {
          commentsByRepo.set(projectId, { comments: 0, mrsReviewed: 0 });
        }
        commentsByRepo.get(projectId).comments += validNotes.length;
        commentsByRepo.get(projectId).mrsReviewed++;
      }
    }));
    
    if ((i + batchSize) % 200 === 0) {
      console.log(`    Processed ${Math.min(i + batchSize, mrsArray.length)}/${mrsArray.length} MRs`);
    }
  }
  
  // Get project names for repo breakdown
  const projectIds = [...commentsByRepo.keys()].filter(id => id !== 'unknown');
  const projectNamesMap = await getProjectNames(projectIds);
  
  const byRepo = Array.from(commentsByRepo.entries()).map(([projectId, data]) => ({
    repo: projectNamesMap.get(projectId) || projectId,
    comments: data.comments,
    mrsReviewed: data.mrsReviewed
  })).sort((a, b) => b.comments - a.comments);

  const result = {
    totalComments,
    mrsReviewed: mrsWithComments,
    avgCommentsPerMR: mrsWithComments > 0 ? Math.round((totalComments / mrsWithComments) * 10) / 10 : 0,
    avgReviewsPerMonth: Math.round((mrsWithComments / Math.max(1, commentsByMonth.size)) * 10) / 10,
    byRepo,
    monthlyComments: Object.fromEntries(commentsByMonth)
  };

  cache.set(cacheKey, result, 300);
  console.log(`  ✓ Done: ${mrsWithComments} MRs, ${totalComments} comments (${Date.now() - startTime}ms)`);
  
  return result;
}

module.exports = {
  getStats,
  getAllMRsForPage,
  getReviewComments,
  getActionStats
};
