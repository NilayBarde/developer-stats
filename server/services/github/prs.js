/**
 * GitHub Pull Requests
 * 
 * Handles fetching PRs via GraphQL API.
 */

const cache = require('../../utils/cache');
const { graphqlQuery, AUTHORED_PRS_QUERY, GITHUB_USERNAME } = require('./api');

/**
 * Fetch all PRs authored by user via GraphQL
 */
async function getAllPRs() {
  const cacheKey = 'github-prs:v3';
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('✓ GitHub PRs served from cache');
    return cached;
  }

  const startTime = Date.now();
  console.log('📦 Fetching GitHub PRs via GraphQL...');

  const allPRs = [];
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
    const data = await graphqlQuery(AUTHORED_PRS_QUERY, { login: GITHUB_USERNAME, cursor });
    const connection = data.user?.pullRequests;
    
    if (!connection?.nodes) break;

    for (const pr of connection.nodes) {
      allPRs.push({
        id: pr.id,
        number: pr.number,
        title: pr.title,
        state: pr.state?.toLowerCase(),
        created_at: pr.createdAt,
        updated_at: pr.updatedAt,
        closed_at: pr.closedAt,
        html_url: pr.url,
        repository_url: pr.repository?.url?.replace('https://github.com', 'https://api.github.com/repos'),
        _repoName: pr.repository?.nameWithOwner,
        pull_request: { merged_at: pr.mergedAt }
      });
    }

    hasNextPage = connection.pageInfo.hasNextPage;
    cursor = connection.pageInfo.endCursor;
    
    if (allPRs.length % 200 === 0) {
      console.log(`    Fetched ${allPRs.length} PRs...`);
    }
  }

  console.log(`  ✓ Found ${allPRs.length} PRs (${Date.now() - startTime}ms)`);
  cache.set(cacheKey, allPRs, 300);
  return allPRs;
}

module.exports = {
  getAllPRs
};

