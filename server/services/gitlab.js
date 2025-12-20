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

async function getAllMergeRequests(dateRange = null) {
  // Check cache for raw MRs (cache for 5 minutes)
  // v2: Only includes authored MRs (assigned/reviewer/commented MRs disabled)
  // Note: dateRange is used for filtering in getMRsFromCommentEvents, but MRs themselves don't change
  // so we cache all MRs without dateRange dependency
  const cache = require('../utils/cache');
  const cacheKey = 'gitlab-all-mrs:v2';
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ GitLab MRs served from cache');
    return cached;
  }
  
  const mrsMap = new Map(); // Use Map to deduplicate MRs by ID
  
  // Fetch MRs authored by user
  let page = 1;
  let hasMore = true;
  console.log('🔷 Fetching MRs authored by user...');
  while (hasMore) {
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
        response.data.forEach(mr => mrsMap.set(mr.id, mr));
        page++;
        if (response.data.length < 100) {
          hasMore = false;
        }
      }
    } catch (error) {
      console.error(`Error fetching authored MRs page ${page}:`, error.message);
      hasMore = false;
    }
  }
  console.log(`  ✓ Found ${mrsMap.size} MRs authored by user`);
  
  // ASSIGNED/REVIEWER/COMMENTED MRs DISABLED - Set to true to include MRs where user is assigned/reviewer/commented
  const INCLUDE_ASSIGNED_REVIEWER_COMMENTED_MRS = false;
  
  if (INCLUDE_ASSIGNED_REVIEWER_COMMENTED_MRS) {
    // Fetch MRs where user is assigned or reviewer
    // GitLab API doesn't have a direct "commented" filter, but we can get MRs where user is involved
    page = 1;
    hasMore = true;
    console.log('🔷 Fetching MRs where user is assigned/reviewer...');
    while (hasMore) {
      try {
        const response = await gitlabApi.get('/merge_requests', {
          params: {
            assignee_username: GITLAB_USERNAME,
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
          response.data.forEach(mr => mrsMap.set(mr.id, mr)); // Deduplicate
          page++;
          if (response.data.length < 100) {
            hasMore = false;
          }
        }
      } catch (error) {
        console.error(`Error fetching assigned MRs page ${page}:`, error.message);
        hasMore = false;
      }
    }
    
    // Also fetch MRs where user is reviewer
    page = 1;
    hasMore = true;
    console.log('🔷 Fetching MRs where user is reviewer...');
    while (hasMore) {
      try {
        const response = await gitlabApi.get('/merge_requests', {
          params: {
            reviewer_username: GITLAB_USERNAME,
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
          response.data.forEach(mr => mrsMap.set(mr.id, mr)); // Deduplicate
          page++;
          if (response.data.length < 100) {
            hasMore = false;
          }
        }
      } catch (error) {
        console.error(`Error fetching reviewer MRs page ${page}:`, error.message);
        hasMore = false;
      }
    }
    
    console.log(`  ✓ Found ${mrsMap.size} total MRs (authored + assigned + reviewer)`);
    
    // Fetch MRs where user commented but wasn't assigned/reviewer (using Events API)
    await getMRsFromCommentEvents(mrsMap, dateRange);
    
    console.log(`  ✓ Found ${mrsMap.size} total MRs (including all commented MRs)`);
  } else {
    console.log(`  ✓ Skipping assigned/reviewer/commented MRs (INCLUDE_ASSIGNED_REVIEWER_COMMENTED_MRS disabled)`);
    console.log(`  ✓ Found ${mrsMap.size} total MRs (authored only)`);
  }

  const mrs = Array.from(mrsMap.values());

  // Cache MRs for 5 minutes
  cache.set(cacheKey, mrs, 300);
  return mrs;
}

async function getCurrentUser() {
  try {
    const response = await gitlabApi.get('/user');
    return response.data;
  } catch (error) {
    console.error('Error fetching GitLab current user:', error.message);
    return null;
  }
}

async function getProjectNames(projectIds) {
  const cache = require('../utils/cache');
  const projectNamesMap = new Map();
  const uniqueIds = [...new Set(projectIds.filter(id => id && id !== 'unknown'))];
  
  if (uniqueIds.length === 0) {
    return projectNamesMap;
  }
  
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
    
    // Fetch project names in batches
    const batchSize = 20;
    for (let i = 0; i < idsToFetch.length; i += batchSize) {
      const batch = idsToFetch.slice(i, i + batchSize);
      const promises = batch.map(async (projectId) => {
        try {
          const response = await gitlabApi.get(`/projects/${projectId}`, {
            params: {
              simple: true // Only get basic info
            }
          });
          const name = response.data.path_with_namespace || response.data.name || projectId.toString();
          // Cache for 1 hour
          const cacheKey = `gitlab-project-name:${projectId}`;
          cache.set(cacheKey, name, 3600);
          return { id: projectId, name };
        } catch (error) {
          // If project doesn't exist or we don't have access, use project ID
          const name = projectId.toString();
          const cacheKey = `gitlab-project-name:${projectId}`;
          cache.set(cacheKey, name, 3600); // Cache even failures to avoid retrying
          return { id: projectId, name };
        }
      });
      
      const results = await Promise.all(promises);
      results.forEach(({ id, name }) => {
        projectNamesMap.set(id.toString(), name);
      });
      
      // Small delay between batches
      if (i + batchSize < idsToFetch.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }
  
  console.log(`  ✓ Resolved names for ${projectNamesMap.size} projects`);
  return projectNamesMap;
}

async function getMRsFromCommentEvents(mrsMap, dateRange = null) {
  try {
    // Get current user to fetch their events
    const currentUser = await getCurrentUser();
    if (!currentUser || !currentUser.id) {
      console.log('  ⚠️ Could not fetch current user, skipping Events API');
      return;
    }

    const mrIdentifiers = new Set(); // Store unique MR identifiers (project_id:iid)
    
    // Determine date range for events - use provided dateRange or default to last 2 years
    let afterDate = null;
    let beforeDate = null;
    if (dateRange) {
      if (dateRange.start === null && dateRange.end === null) {
        // All time - default to last 2 years to avoid deleted MRs
        const twoYearsAgo = new Date();
        twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
        afterDate = twoYearsAgo.toISOString().split('T')[0];
      } else {
        if (dateRange.start) {
          afterDate = dateRange.start;
        }
        if (dateRange.end) {
          beforeDate = dateRange.end;
        }
      }
    } else {
      // Default to last 2 years to avoid deleted MRs
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      afterDate = twoYearsAgo.toISOString().split('T')[0];
    }
    
    // Fetch events for multiple action types to catch all interactions
    const actionTypes = ['commented', 'approved'];
    
    for (const action of actionTypes) {
      let page = 1;
      let hasMore = true;
      let totalEvents = 0;
      console.log(`🔷 Fetching MRs where user ${action} (via Events API)...`);

      while (hasMore && page <= 20) { // Limit to 20 pages (2000 events max per action)
        try {
          const params = {
            action: action,
            target_type: 'merge_request',
            per_page: 100,
            page: page
          };
          
          // Add date filters if provided
          if (afterDate) {
            params.after = afterDate;
          }
          if (beforeDate) {
            params.before = beforeDate;
          }
          
          const response = await gitlabApi.get(`/users/${currentUser.id}/events`, {
            params: params
          });

          if (response.data.length === 0) {
            hasMore = false;
          } else {
            // Extract MR identifiers from events
            response.data.forEach(event => {
              if (event.target_id && event.project_id) {
                // Store as project_id:iid for uniqueness
                // Note: target_id in events is the MR's internal ID (iid), not the global ID
                mrIdentifiers.add(`${event.project_id}:${event.target_id}`);
              }
            });
            totalEvents += response.data.length;
            page++;
            if (response.data.length < 100) {
              hasMore = false;
            }
          }
        } catch (error) {
          console.error(`Error fetching ${action} events page ${page}:`, error.message);
          hasMore = false;
        }
      }
      console.log(`  ✓ Processed ${totalEvents} ${action} events`);
    }

    console.log(`  ✓ Found ${mrIdentifiers.size} unique MRs from Events API (all actions)`);

    // Now fetch the full MR details for each unique MR
    // We'll fetch them in batches to avoid rate limits
    const mrFetchBatchSize = 10;
    const identifiersArray = Array.from(mrIdentifiers);
    let fetchedCount = 0;
    let newMRsCount = 0;

    for (let i = 0; i < identifiersArray.length; i += mrFetchBatchSize) {
      const batch = identifiersArray.slice(i, i + mrFetchBatchSize);
      const mrPromises = batch.map(async (identifier) => {
        const [projectId, iid] = identifier.split(':');
        try {
          const response = await gitlabApi.get(`/projects/${projectId}/merge_requests/${iid}`);
          return response.data;
        } catch (error) {
          // MR might have been deleted (404) or we don't have access - silently skip
          // Don't log 404s as they're expected for deleted MRs
          if (error.response?.status !== 404) {
            // Only log non-404 errors
            console.error(`Error fetching MR ${iid} from project ${projectId}:`, error.message);
          }
          return null;
        }
      });

      const batchMRs = await Promise.all(mrPromises);
      batchMRs.forEach(mr => {
        if (mr && !mrsMap.has(mr.id)) {
          mrsMap.set(mr.id, mr);
          newMRsCount++;
        }
        if (mr) fetchedCount++;
      });

      // Small delay between batches to respect rate limits
      if (i + mrFetchBatchSize < identifiersArray.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    console.log(`  ✓ Fetched ${fetchedCount} MRs, ${newMRsCount} new MRs added (not already in collection)`);
  } catch (error) {
    console.error('Error fetching MRs from comment events:', error.message);
    // Don't throw - this is a nice-to-have feature, shouldn't break the main flow
  }
}

async function getStats(dateRange = null) {
  const hasCredentials = GITLAB_USERNAME && GITLAB_TOKEN && 
                         GITLAB_USERNAME.trim() !== '' && 
                         GITLAB_TOKEN.trim() !== '';
  
  if (!hasCredentials) {
    throw new Error('GitLab credentials not configured. Please set GITLAB_USERNAME, GITLAB_TOKEN, and GITLAB_BASE_URL environment variables.');
  }

  // Check cache for stats (cache for 5 minutes)
  const cache = require('../utils/cache');
  const statsCacheKey = `gitlab-stats:${JSON.stringify(dateRange)}`;
  const cachedStats = cache.get(statsCacheKey);
  if (cachedStats) {
    console.log('✓ GitLab stats served from cache');
    return cachedStats;
  }

  try {
    const mrs = await getAllMergeRequests(dateRange);
    
    // Get unique project IDs and fetch their names
    const projectIds = [...new Set(mrs.map(mr => mr.project_id).filter(Boolean))];
    const projectNamesMap = await getProjectNames(projectIds);
    
    const stats = calculatePRStats(mrs, [], dateRange, {
      mergedField: 'merged_at',
      getState: (mr) => mr.state,
      // Only count as merged if state is 'merged' (not 'closed')
      isMerged: (mr) => mr.state === 'merged',
      isOpen: (mr) => mr.state === 'opened',
      // Count as closed only if state is 'closed' (closed but not merged)
      isClosed: (mr) => mr.state === 'closed',
      groupByKey: (mr) => {
        // Use project name from map, fallback to project_id
        const projectId = mr.project_id?.toString();
        if (projectId && projectNamesMap.has(projectId)) {
          return projectNamesMap.get(projectId);
        }
        // Try to use project path if available in MR object
        if (mr.project?.path_with_namespace) {
          return mr.project.path_with_namespace;
        }
        if (mr.project?.name) {
          return mr.project.name;
        }
        return projectId || 'unknown';
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
    
    // Cache stats for 5 minutes
    cache.set(statsCacheKey, result, 300);
    
    return result;
  } catch (error) {
    console.error('❌ Error fetching GitLab stats:', error.message);
    throw error;
  }
}

async function getAllMRsForPage(dateRange = null) {
  const { filterByDateRange } = require('../utils/dateHelpers');
  
  // Get all MRs (from cache if available)
  const mrs = await getAllMergeRequests();
  
  // Filter by date range if provided
  let filteredMRs = dateRange 
    ? filterByDateRange(mrs, 'created_at', dateRange)
    : mrs;
  
  // Get unique project IDs and fetch their names
  const projectIds = [...new Set(filteredMRs.map(mr => mr.project_id).filter(Boolean))];
  const projectNamesMap = await getProjectNames(projectIds);
  
  // Add project names to MRs
  filteredMRs = filteredMRs.map(mr => {
    const projectId = mr.project_id?.toString();
    const projectName = projectId && projectNamesMap.has(projectId)
      ? projectNamesMap.get(projectId)
      : (mr.project?.path_with_namespace || mr.project?.name || projectId || 'unknown');
    
    return {
      ...mr,
      _projectName: projectName // Add project name for client display
    };
  });
  
  // Sort by updated date descending (most recent first)
  filteredMRs.sort((a, b) => {
    const dateA = new Date(a.updated_at || a.created_at || 0);
    const dateB = new Date(b.updated_at || b.created_at || 0);
    return dateB - dateA;
  });
  
  return filteredMRs;
}

module.exports = {
  getStats,
  getAllMRsForPage
};
