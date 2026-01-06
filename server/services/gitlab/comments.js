/**
 * GitLab Review Comments
 * 
 * Handles fetching comments made by user on MRs.
 */

const cache = require('../../utils/cache');
const { gitlabApi, GITLAB_USERNAME, GITLAB_TOKEN } = require('./api');
const { getAllMergeRequests, getProjectNames } = require('./mrs');

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
  getReviewComments
};

