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

const gitlabApi = axios.create({
  baseURL: `${GITLAB_BASE_URL}/api/v4`,
  headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN },
  timeout: 30000
});

/**
 * Fetch all MRs authored by user
 */
async function getAllMergeRequests() {
  const cacheKey = 'gitlab-all-mrs:v2';
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ GitLab MRs served from cache');
    return cached;
  }
  
  const mrsMap = new Map();
  let page = 1;
  let hasMore = true;
  
  console.log('🔷 Fetching MRs authored by user...');
  
  while (hasMore) {
    try {
      const response = await gitlabApi.get('/merge_requests', {
        params: {
          author_username: GITLAB_USERNAME,
          per_page: 100,
          page,
          order_by: 'created_at',
          sort: 'desc',
          state: 'all'
        }
      });

      if (response.data.length === 0) {
        hasMore = false;
      } else {
        response.data.forEach(mr => mrsMap.set(mr.id, mr));
        page++;
        if (response.data.length < 100) hasMore = false;
      }
    } catch (error) {
      console.error(`Error fetching authored MRs page ${page}:`, error.message);
      hasMore = false;
    }
  }
  
  console.log(`  ✓ Found ${mrsMap.size} MRs authored by user`);

  const mrs = Array.from(mrsMap.values());
  cache.set(cacheKey, mrs, 300);
  return mrs;
}

/**
 * Batch fetch project names for given project IDs
 */
async function getProjectNames(projectIds) {
  const projectNamesMap = new Map();
  const uniqueIds = [...new Set(projectIds.filter(id => id && id !== 'unknown'))];
  
  if (uniqueIds.length === 0) return projectNamesMap;
  
  // Check cache first
  const idsToFetch = [];
  uniqueIds.forEach(id => {
    const cacheKey = `gitlab-project-name:${id}`;
    const cachedName = cache.get(cacheKey);
    if (cachedName) {
      projectNamesMap.set(id.toString(), cachedName);
    } else {
      idsToFetch.push(id);
    }
  });
  
  if (idsToFetch.length > 0) {
    console.log(`🔷 Fetching names for ${idsToFetch.length} projects (${projectNamesMap.size} from cache)...`);
    
    const batchSize = 20;
    for (let i = 0; i < idsToFetch.length; i += batchSize) {
      const batch = idsToFetch.slice(i, i + batchSize);
      const promises = batch.map(async (projectId) => {
        try {
          const response = await gitlabApi.get(`/projects/${projectId}`, {
            params: { simple: true }
          });
          const name = response.data.path_with_namespace || response.data.name || projectId.toString();
          cache.set(`gitlab-project-name:${projectId}`, name, 3600);
          return { id: projectId, name };
        } catch {
          const name = projectId.toString();
          cache.set(`gitlab-project-name:${projectId}`, name, 3600);
          return { id: projectId, name };
        }
      });
      
      const results = await Promise.all(promises);
      results.forEach(({ id, name }) => projectNamesMap.set(id.toString(), name));
      
      if (i + batchSize < idsToFetch.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }
  
  console.log(`  ✓ Resolved names for ${projectNamesMap.size} projects`);
  return projectNamesMap;
}

/**
 * Get GitLab stats with optional date range filtering
 */
async function getStats(dateRange = null) {
  const hasCredentials = GITLAB_USERNAME && GITLAB_TOKEN && 
                         GITLAB_USERNAME.trim() !== '' && 
                         GITLAB_TOKEN.trim() !== '';
  
  if (!hasCredentials) {
    throw new Error('GitLab credentials not configured. Please set GITLAB_USERNAME, GITLAB_TOKEN, and GITLAB_BASE_URL environment variables.');
  }

  const statsCacheKey = `gitlab-stats:${JSON.stringify(dateRange)}`;
  const cachedStats = cache.get(statsCacheKey);
  if (cachedStats) {
    console.log('✓ GitLab stats served from cache');
    return cachedStats;
  }

  try {
    const mrs = await getAllMergeRequests();
    
    // Get project names
    const projectIds = [...new Set(mrs.map(mr => mr.project_id).filter(Boolean))];
    const projectNamesMap = await getProjectNames(projectIds);
    
    const stats = calculatePRStats(mrs, [], dateRange, {
      mergedField: 'merged_at',
      getState: (mr) => mr.state,
      isMerged: (mr) => mr.state === 'merged',
      isOpen: (mr) => mr.state === 'opened',
      isClosed: (mr) => mr.state === 'closed',
      groupByKey: (mr) => {
        const projectId = mr.project_id?.toString();
        if (projectId && projectNamesMap.has(projectId)) {
          return projectNamesMap.get(projectId);
        }
        return mr.project?.path_with_namespace || mr.project?.name || projectId || 'unknown';
      }
    });
    
    const result = {
      ...stats,
      source: 'gitlab',
      username: GITLAB_USERNAME,
      byProject: stats.grouped,
      mrs: stats.items,
      monthlyMRs: stats.monthlyMRs || [],
      avgMRsPerMonth: stats.avgMRsPerMonth
    };
    
    cache.set(statsCacheKey, result, 300);
    return result;
  } catch (error) {
    console.error('❌ Error fetching GitLab stats:', error.message);
    throw error;
  }
}

/**
 * Fetch ALL comments made by user on MRs (both own and others')
 * OPTIMIZED: Prioritizes Events API which directly tells us which MRs user commented on,
 * avoiding the need to scan all MRs in all projects.
 * 
 * Strategy:
 * 1. Events API (primary) - Tells us exactly which MRs user commented on (last ~90 days)
 * 2. Reviewer MRs - MRs where user was assigned as reviewer (likely commented)
 * 3. Own MRs - User's authored MRs (might have self-comments)
 * 
 * We skip scanning all project MRs which was the main bottleneck.
 */
async function getReviewComments(dateRange = null) {
  const hasCredentials = GITLAB_USERNAME && GITLAB_TOKEN && 
                         GITLAB_USERNAME.trim() !== '' && 
                         GITLAB_TOKEN.trim() !== '';
  
  if (!hasCredentials) {
    return { totalComments: 0, mrsReviewed: 0, avgCommentsPerMR: 0, avgReviewsPerMonth: 0, byRepo: [] };
  }

  const cacheKey = `gitlab-all-comments:v2:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ GitLab comments served from cache');
    return cached;
  }

  const startTime = Date.now();
  console.log('🔷 Fetching GitLab comments (optimized)...');
  
  // Track all MRs we've found comments on
  const reviewedMRs = new Map();
  const mrsToCheck = new Map();
  
  // Step 1: Events API (PRIMARY SOURCE - this is the key optimization)
  // The Events API tells us exactly which MRs the user commented on
  console.log('  → [1/3] Fetching comment events from Events API (primary source)...');
  let eventsPage = 1;
  let hasMoreEvents = true;
  let eventCount = 0;
  
  while (hasMoreEvents) {
    try {
      const response = await gitlabApi.get('/events', {
        params: {
          action: 'commented',
          per_page: 100,
          page: eventsPage
        }
      });
      
      if (response.data.length === 0) {
        hasMoreEvents = false;
      } else {
        for (const event of response.data) {
          if (event.target_type === 'MergeRequest' && event.project_id && event.target_iid) {
            const key = `${event.project_id}-${event.target_iid}`;
            if (!mrsToCheck.has(key)) {
              mrsToCheck.set(key, {
                project_id: event.project_id,
                iid: event.target_iid,
                title: event.target_title,
                created_at: event.created_at,
                _source: 'events'
              });
              eventCount++;
            }
          }
        }
        eventsPage++;
        if (response.data.length < 100) hasMoreEvents = false;
        if (eventsPage > 100) hasMoreEvents = false; // Extended limit for more coverage
      }
    } catch (error) {
      console.error(`    Events API error:`, error.message);
      hasMoreEvents = false;
    }
  }
  console.log(`    ✓ Found ${eventCount} MRs from Events API (${Date.now() - startTime}ms)`);
  
  // Step 2: Reviewer MRs (user was assigned as reviewer - likely commented)
  console.log('  → [2/3] Fetching MRs where user is reviewer...');
  let reviewerPage = 1;
  let hasMoreReviewer = true;
  let reviewerCount = 0;
  
  while (hasMoreReviewer) {
    try {
      const response = await gitlabApi.get('/merge_requests', {
        params: {
          reviewer_username: GITLAB_USERNAME,
          state: 'all',
          per_page: 100,
          page: reviewerPage,
          scope: 'all'
        }
      });
      
      if (response.data.length === 0) {
        hasMoreReviewer = false;
      } else {
        for (const mr of response.data) {
          const key = `${mr.project_id}-${mr.iid}`;
          if (!mrsToCheck.has(key)) {
            mrsToCheck.set(key, { ...mr, _source: 'reviewer' });
            reviewerCount++;
          }
        }
        reviewerPage++;
        if (response.data.length < 100) hasMoreReviewer = false;
        if (reviewerPage > 50) hasMoreReviewer = false;
      }
    } catch (error) {
      console.error(`    Reviewer MRs error:`, error.message);
      hasMoreReviewer = false;
    }
  }
  console.log(`    ✓ Found ${reviewerCount} additional MRs as reviewer (${Date.now() - startTime}ms)`);
  
  // Step 3: Own MRs (might have self-comments or discussions)
  console.log('  → [3/3] Adding own MRs...');
  const ownMRs = await getAllMergeRequests();
  let ownCount = 0;
  for (const mr of ownMRs) {
    const key = `${mr.project_id}-${mr.iid}`;
    if (!mrsToCheck.has(key)) {
      mrsToCheck.set(key, { ...mr, _source: 'own' });
      ownCount++;
    }
  }
  console.log(`    ✓ Added ${ownCount} own MRs (${Date.now() - startTime}ms)`);
  
  console.log(`  → Total unique MRs to check: ${mrsToCheck.size}`);
  
  // Fetch notes for each MR to count user's comments
  // Use larger batch size and cache individual MR results
  const mrsArray = Array.from(mrsToCheck.values());
  const batchSize = 50; // Increased from 30
  let processedCount = 0;
  
  // Track stats
  const commentsByMonth = new Map();
  const commentsByRepo = new Map();
  let totalComments = 0;
  
  console.log(`  → Fetching notes for ${mrsArray.length} MRs...`);
  
  for (let i = 0; i < mrsArray.length; i += batchSize) {
    const batch = mrsArray.slice(i, i + batchSize);
    
    await Promise.all(batch.map(async (mr) => {
      // Check per-MR cache first
      const mrCacheKey = `gitlab-mr-notes:${mr.project_id}-${mr.iid}`;
      const cachedNotes = cache.get(mrCacheKey);
      
      let userNotes = cachedNotes;
      
      if (!userNotes) {
        try {
          // Fetch notes (usually 1 page is enough, most MRs have < 100 notes)
          const response = await gitlabApi.get(
            `/projects/${mr.project_id}/merge_requests/${mr.iid}/notes`,
            { params: { per_page: 100 } }
          );
          
          // Filter to user's non-system notes
          userNotes = (response.data || []).filter(note => 
            note.author?.username === GITLAB_USERNAME && !note.system
          );
          
          // Cache for 10 minutes (individual MR cache)
          cache.set(mrCacheKey, userNotes, 600);
        } catch {
          userNotes = [];
        }
      }
      
      if (userNotes.length > 0) {
        const key = `${mr.project_id}-${mr.iid}`;
        
        // Apply date range filter
        const validNotes = userNotes.filter(note => {
          if (!dateRange?.start && !dateRange?.end) return true;
          const noteDate = new Date(note.created_at);
          if (dateRange.start && noteDate < new Date(dateRange.start)) return false;
          if (dateRange.end && noteDate > new Date(dateRange.end)) return false;
          return true;
        });
        
        if (validNotes.length > 0) {
          reviewedMRs.set(key, {
            projectId: mr.project_id,
            mrIid: mr.iid,
            title: mr.title,
            comments: validNotes.length
          });
          
          // Track each note's month
          for (const note of validNotes) {
            const month = note.created_at?.substring(0, 7) || 'unknown';
            commentsByMonth.set(month, (commentsByMonth.get(month) || 0) + 1);
          }
          
          // Track repo stats
          const projectId = mr.project_id?.toString() || 'unknown';
          if (!commentsByRepo.has(projectId)) {
            commentsByRepo.set(projectId, { projectId, comments: 0, mrsReviewed: 0 });
          }
          commentsByRepo.get(projectId).comments += validNotes.length;
          commentsByRepo.get(projectId).mrsReviewed++;
          
          totalComments += validNotes.length;
        }
      }
    }));
    
    processedCount += batch.length;
    if (processedCount % 200 === 0 || processedCount === mrsArray.length) {
      console.log(`    Processed ${processedCount}/${mrsArray.length} MRs (${Date.now() - startTime}ms)`);
    }
    
    // Minimal delay between batches
    if (i + batchSize < mrsArray.length) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  
  // Get project names
  const projectIds = [...commentsByRepo.keys()].filter(id => id !== 'unknown');
  const projectNamesMap = await getProjectNames(projectIds);

  // Build results
  const byRepo = Array.from(commentsByRepo.entries()).map(([projectId, data]) => ({
    repo: projectNamesMap.get(projectId) || projectId,
    comments: data.comments,
    mrsReviewed: data.mrsReviewed
  })).sort((a, b) => b.comments - a.comments);

  const mrsReviewed = reviewedMRs.size;
  const avgCommentsPerMR = mrsReviewed > 0 ? Math.round((totalComments / mrsReviewed) * 10) / 10 : 0;
  const numMonths = commentsByMonth.size || 1;
  const avgReviewsPerMonth = Math.round((mrsReviewed / numMonths) * 10) / 10;

  const result = {
    totalComments,
    mrsReviewed,
    avgCommentsPerMR,
    avgReviewsPerMonth,
    byRepo,
    monthlyComments: Object.fromEntries(commentsByMonth)
  };

  cache.set(cacheKey, result, 300);
  console.log(`  ✓ Done: ${mrsReviewed} MRs with ${totalComments} comments (${Date.now() - startTime}ms total)`);
  
  return result;
}

/**
 * Get all MRs for the MRs page with date filtering
 */
async function getAllMRsForPage(dateRange = null) {
  const mrs = await getAllMergeRequests();
  
  // Get project names for filtered MRs
  const projectIds = [...new Set(mrs.map(mr => mr.project_id).filter(Boolean))];
  const projectNamesMap = await getProjectNames(projectIds);
  
  // Transform function to add project names
  const transformFn = (mr) => {
    const projectId = mr.project_id?.toString();
    const projectName = projectId && projectNamesMap.has(projectId)
      ? projectNamesMap.get(projectId)
      : (mr.project?.path_with_namespace || mr.project?.name || projectId || 'unknown');
    
    return { ...mr, _projectName: projectName };
  };
  
  return prepareItemsForPage(mrs, dateRange, transformFn);
}

module.exports = {
  getStats,
  getAllMRsForPage,
  getReviewComments
};
