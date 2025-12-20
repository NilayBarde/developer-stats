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
  getAllMRsForPage
};
