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
 * Uses multiple approaches to get comprehensive data:
 * 1. User's own MRs
 * 2. MRs where user was assigned as reviewer
 * 3. Recent MRs from contributed projects
 */
async function getReviewComments(dateRange = null) {
  const hasCredentials = GITLAB_USERNAME && GITLAB_TOKEN && 
                         GITLAB_USERNAME.trim() !== '' && 
                         GITLAB_TOKEN.trim() !== '';
  
  if (!hasCredentials) {
    return { totalComments: 0, mrsReviewed: 0, avgCommentsPerMR: 0, avgReviewsPerMonth: 0, byRepo: [] };
  }

  const cacheKey = `gitlab-all-comments:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ GitLab comments served from cache');
    return cached;
  }

  console.log('🔷 Fetching GitLab comments (all MRs - own + others)...');
  
  // Get user's own MRs - we'll INCLUDE these for comment counting
  const ownMRs = await getAllMergeRequests();
  console.log(`    Found ${ownMRs.length} own MRs to check for comments`);
  
  // Track all MRs we've found comments on
  const reviewedMRs = new Map(); // key: project_id-iid, value: { projectId, mrIid, comments, createdAt }
  
  // Approach 1: Get MRs where user is/was reviewer
  console.log('  → Fetching MRs where user is reviewer...');
  let reviewerMRs = [];
  let page = 1;
  let hasMore = true;
  
  while (hasMore) {
    try {
      const response = await gitlabApi.get('/merge_requests', {
        params: {
          reviewer_username: GITLAB_USERNAME,
          state: 'all',
          per_page: 100,
          page,
          scope: 'all'
        }
      });
      
      if (response.data.length === 0) {
        hasMore = false;
      } else {
        reviewerMRs.push(...response.data);
        page++;
        if (response.data.length < 100) hasMore = false;
        if (page > 50) hasMore = false;
      }
    } catch (error) {
      console.error(`Error fetching reviewer MRs:`, error.message);
      hasMore = false;
    }
  }
  
  console.log(`    Found ${reviewerMRs.length} MRs as reviewer`);
  
  // Approach 2: Get ALL accessible projects (not just contributed ones)
  // This catches comments on MRs in projects user has access to but never authored MRs in
  console.log('  → Fetching all accessible projects...');
  
  let allProjectIds = [];
  let projectPage = 1;
  let hasMoreProjects = true;
  
  while (hasMoreProjects) {
    try {
      const response = await gitlabApi.get('/projects', {
        params: {
          membership: true,
          per_page: 100,
          page: projectPage,
          simple: true
        }
      });
      
      if (response.data.length === 0) {
        hasMoreProjects = false;
      } else {
        allProjectIds.push(...response.data.map(p => p.id));
        projectPage++;
        if (response.data.length < 100) hasMoreProjects = false;
        if (projectPage > 5) hasMoreProjects = false; // Up to 500 projects
      }
    } catch (error) {
      console.error(`    Error fetching projects:`, error.message);
      hasMoreProjects = false;
    }
  }
  
  // Also include contributed project IDs (in case membership doesn't catch all)
  const contributedProjectIds = [...new Set(ownMRs.map(mr => mr.project_id).filter(Boolean))];
  const uniqueProjectIds = [...new Set([...allProjectIds, ...contributedProjectIds])];
  console.log(`    Found ${uniqueProjectIds.length} accessible projects (${allProjectIds.length} from membership + ${contributedProjectIds.length} from contributions)`);
  
  let recentMRs = [];
  // Fetch MRs from each project with pagination (up to 1000 MRs per project)
  const projectBatchSize = 5;
  for (let i = 0; i < Math.min(uniqueProjectIds.length, 100); i += projectBatchSize) {
    const projectBatch = uniqueProjectIds.slice(i, i + projectBatchSize);
    
    const batchResults = await Promise.all(projectBatch.map(async (projectId) => {
      try {
        // Fetch multiple pages of MRs per project
        let projectMRs = [];
        let mrPage = 1;
        let hasMoreMRs = true;
        
        while (hasMoreMRs) {
          const response = await gitlabApi.get(`/projects/${projectId}/merge_requests`, {
            params: {
              state: 'all',
              per_page: 100,
              page: mrPage,
              order_by: 'updated_at',
              sort: 'desc'
            }
          });
          
          if (response.data.length === 0) {
            hasMoreMRs = false;
          } else {
            projectMRs.push(...response.data);
            mrPage++;
            if (response.data.length < 100) hasMoreMRs = false;
            if (mrPage > 10) hasMoreMRs = false; // Up to 1000 MRs per project
          }
        }
        
        return projectMRs;
      } catch {
        return [];
      }
    }));
    
    recentMRs.push(...batchResults.flat());
  }
  
  console.log(`    Found ${recentMRs.length} recent MRs from contributed projects`);
  
  // Approach 3: Use Events API to find MRs user commented on (catches MRs we might have missed)
  // This is limited to ~90 days but helps for recent data
  console.log('  → Fetching comment events from Events API...');
  let eventMRs = [];
  let eventsPage = 1;
  let hasMoreEvents = true;
  
  while (hasMoreEvents) {
    try {
      // Fetch all commented events, filter for MergeRequests client-side
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
        // Extract MR info from events (filter to MergeRequest target_type)
        for (const event of response.data) {
          if (event.target_type === 'MergeRequest' && event.project_id && event.target_iid) {
            eventMRs.push({
              project_id: event.project_id,
              iid: event.target_iid,
              title: event.target_title,
              created_at: event.created_at,
              updated_at: event.created_at
            });
          }
        }
        eventsPage++;
        if (response.data.length < 100) hasMoreEvents = false;
        if (eventsPage > 50) hasMoreEvents = false; // Safety limit
      }
    } catch (error) {
      console.error(`    Events API error:`, error.message);
      hasMoreEvents = false;
    }
  }
  
  console.log(`    Found ${eventMRs.length} comment events from Events API`);
  
  // Combine ALL MRs: own MRs + reviewer MRs + recent project MRs + event MRs (dedupe by key)
  const mrsToCheck = new Map();
  
  // Add own MRs first
  ownMRs.forEach(mr => {
    const key = `${mr.project_id}-${mr.iid}`;
    if (!mrsToCheck.has(key)) {
      mrsToCheck.set(key, mr);
    }
  });
  
  // Add reviewer MRs, recent MRs, and event MRs
  [...reviewerMRs, ...recentMRs, ...eventMRs].forEach(mr => {
    const key = `${mr.project_id}-${mr.iid}`;
    if (!mrsToCheck.has(key)) {
      mrsToCheck.set(key, mr);
    }
  });
  
  console.log(`    Total unique MRs to check: ${mrsToCheck.size}`);
  
  // Check ALL MRs - date filtering happens at the note level, not MR level
  // This ensures we don't miss comments on older MRs that fall within the date range
  console.log(`  → Checking notes on ${mrsToCheck.size} MRs (no MR-level date filter)...`);
  
  // Fetch notes for each MR to count user's comments
  const mrsArray = Array.from(mrsToCheck.values());
  const batchSize = 30; // Process 30 MRs in parallel for speed
  let processedCount = 0;
  
  // Track monthly comments directly (each note's actual month)
  const commentsByMonth = new Map();
  const commentsByRepo = new Map();
  let totalComments = 0;
  
  for (let i = 0; i < mrsArray.length; i += batchSize) {
    const batch = mrsArray.slice(i, i + batchSize);
    
    await Promise.all(batch.map(async (mr) => {
      try {
        // Fetch ALL notes with pagination (some MRs have 100+ comments)
        // Don't use activity_filter to catch all note types including discussions
        let allNotes = [];
        let notesPage = 1;
        let hasMoreNotes = true;
        
        while (hasMoreNotes) {
          const response = await gitlabApi.get(
            `/projects/${mr.project_id}/merge_requests/${mr.iid}/notes`,
            { params: { per_page: 100, page: notesPage } }
          );
          
          if (response.data.length === 0) {
            hasMoreNotes = false;
          } else {
            allNotes.push(...response.data);
            notesPage++;
            if (response.data.length < 100) hasMoreNotes = false;
            if (notesPage > 3) hasMoreNotes = false; // Up to 300 notes per MR
          }
        }
        
        // Filter to user's notes, excluding system notes manually
        // System notes have `system: true` flag
        const userNotes = allNotes.filter(note => 
          note.author?.username === GITLAB_USERNAME && !note.system
        );
        
        if (userNotes.length > 0) {
          const key = `${mr.project_id}-${mr.iid}`;
          
          // Apply date range filter and track each note's actual month
          const validNotes = userNotes.filter(note => {
            if (!dateRange?.start && !dateRange?.end) return true;
            const noteDate = new Date(note.created_at);
            if (dateRange.start && noteDate < new Date(dateRange.start)) return false;
            if (dateRange.end && noteDate > new Date(dateRange.end)) return false;
            return true;
          });
          
          if (validNotes.length > 0) {
            // Track MR-level data
            reviewedMRs.set(key, {
              projectId: mr.project_id,
              mrIid: mr.iid,
              title: mr.title,
              comments: validNotes.length
            });
            
            // Track each note's actual month
            for (const note of validNotes) {
              const month = note.created_at?.substring(0, 7) || 'unknown';
              if (!commentsByMonth.has(month)) {
                commentsByMonth.set(month, 0);
              }
              commentsByMonth.set(month, commentsByMonth.get(month) + 1);
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
      } catch (error) {
        // Silently skip MRs we can't access
      }
    }));
    
    processedCount += batch.length;
    if (processedCount % 100 === 0 || processedCount === mrsArray.length) {
      console.log(`    Processed ${processedCount}/${mrsArray.length} MRs...`);
    }
    
    // Minimal delay between batches to avoid rate limiting
    if (i + batchSize < mrsArray.length) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  
  // Get project names for repos
  const projectIds = [...commentsByRepo.keys()].filter(id => id !== 'unknown');
  const projectNamesMap = await getProjectNames(projectIds);

  // Build repo breakdown with names
  const byRepo = Array.from(commentsByRepo.entries()).map(([projectId, data]) => ({
    repo: projectNamesMap.get(projectId) || projectId,
    comments: data.comments,
    mrsReviewed: data.mrsReviewed
  })).sort((a, b) => b.comments - a.comments);

  const mrsReviewed = reviewedMRs.size;
  const avgCommentsPerMR = mrsReviewed > 0 ? Math.round((totalComments / mrsReviewed) * 10) / 10 : 0;
  
  // Calculate avg reviews per month
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
  console.log(`  ✓ ${mrsReviewed} MRs reviewed with ${totalComments} comments`);
  
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
