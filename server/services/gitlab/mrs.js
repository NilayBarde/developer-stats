/**
 * GitLab Merge Requests
 * 
 * Handles fetching MRs via GraphQL API and project name resolution.
 */

const cache = require('../../utils/cache');
const { graphqlQuery, AUTHORED_MRS_QUERY, gitlabApi } = require('./api');

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

module.exports = {
  getAllMergeRequests,
  getProjectNames
};

