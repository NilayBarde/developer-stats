/**
 * GitLab Merge Requests
 * 
 * Handles fetching MRs via GraphQL API and project name resolution.
 */

const cache = require('../../utils/cache');
const { buildGitLabDateParams } = require('../../utils/gitlabHelpers');
const { gitlabApi, createRestClient } = require('./api');
const { handleApiError } = require('../../utils/apiHelpers');

/**
 * Fetch all MRs authored by user via REST API (supports querying any user)
 * @param {Object|null} credentials - Optional credentials { username, token, baseURL }
 */
async function getAllMergeRequests(credentials = null, dateRange = null) {
  const username = credentials?.username || require('./api').GITLAB_USERNAME;
  const token = credentials?.token || require('./api').GITLAB_TOKEN;
  const baseURL = credentials?.baseURL || require('./api').GITLAB_BASE_URL || 'https://gitlab.com';
  
  const cacheKey = `gitlab-mrs:v5:${username}:${JSON.stringify(dateRange)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ GitLab MRs served from cache');
    return cached;
  }

  const startTime = Date.now();
  console.log(`🔷 Fetching GitLab MRs for ${username}...`);

  const customRestClient = createRestClient(username, token, baseURL);
  const allMRs = [];
  let page = 1;
  const maxPages = 50; // Limit pagination

  // Determine if username is numeric (ID) or string (username)
  const isNumericId = /^\d+$/.test(username);
  const params = {
    state: 'all',
    scope: 'all',
    per_page: 100,
    page: page,
    order_by: 'created_at',
    sort: 'desc',
    // Include project info in response
    with_labels_details: false,
    with_merge_status_recheck: false
  };
  
  // Use author_id for numeric IDs, author_username for usernames
  if (isNumericId) {
    params.author_id = username;
  } else {
    params.author_username = username;
  }
  
  // Add date range filtering if provided
  // Note: GitLab's created_before is exclusive, so buildGitLabDateParams adds 1 day
  // to make it inclusive (include the full end date)
  Object.assign(params, buildGitLabDateParams(dateRange));

  while (page <= maxPages) {
    try {
      const response = await customRestClient.get('/merge_requests', {
        params: {
          ...params,
          page: page
        }
      });

      if (response.data.length === 0) break;
      
      for (const mr of response.data) {
        // Extract project path from references or source/target project
        let projectPath = 'unknown';
        if (mr.references?.full) {
          // Extract project path from full reference (e.g., "group/project!123")
          const match = mr.references.full.match(/^([^!]+)/);
          if (match) projectPath = match[1];
        } else if (mr.source?.path_with_namespace) {
          projectPath = mr.source.path_with_namespace;
        } else if (mr.target?.path_with_namespace) {
          projectPath = mr.target.path_with_namespace;
        } else if (mr.project?.path_with_namespace) {
          projectPath = mr.project.path_with_namespace;
        }
        
        allMRs.push({
          id: mr.id,
          iid: mr.iid,
          title: mr.title,
          state: mr.state?.toLowerCase(),
          created_at: mr.created_at,
          updated_at: mr.updated_at,
          merged_at: mr.merged_at,
          web_url: mr.web_url,
          project_id: mr.project_id?.toString(),
          _projectPath: projectPath
        });
      }

      if (response.data.length < 100) break;
      page++;
    } catch (error) {
      handleApiError(error, 'GitLab');
      break;
    }
  }

  console.log(`  ✓ Found ${allMRs.length} MRs (${Date.now() - startTime}ms)`);
  cache.set(cacheKey, allMRs, 300);
  return allMRs;
}

/**
 * Fetch project names for given IDs (used by getReviewComments)
 * @param {Array} projectIds - Array of project IDs
 * @param {Object|null} credentials - Optional credentials { username, token, baseURL }
 */
async function getProjectNames(projectIds, credentials = null) {
  const projectNamesMap = new Map();
  const uniqueIds = [...new Set(projectIds.filter(id => id && id !== 'unknown'))];
  
  if (uniqueIds.length === 0) return projectNamesMap;
  
  const customRestClient = credentials ? createRestClient(credentials.username, credentials.token, credentials.baseURL) : gitlabApi;
  
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
          const response = await customRestClient.get(`/projects/${projectId}`, { params: { simple: true } });
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

