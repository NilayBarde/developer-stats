/**
 * GitHub Pull Requests
 * 
 * Handles fetching PRs via GraphQL API.
 */

const cache = require('../../utils/cache');
const { graphqlQuery, AUTHORED_PRS_QUERY, GITHUB_USERNAME, createGraphQLClient } = require('./api');

/**
 * Fetch all PRs authored by user via GraphQL
 * @param {Object|null} credentials - Optional credentials { username, token, baseURL }
 */
async function getAllPRs(credentials = null) {
  const username = credentials?.username || GITHUB_USERNAME;
  const cacheKey = `github-prs:v3:${username}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const allPRs = [];
  let hasNextPage = true;
  let cursor = null;
  const customClient = credentials ? createGraphQLClient(username, credentials.token, credentials.baseURL) : null;

  while (hasNextPage) {
    const data = await graphqlQuery(AUTHORED_PRS_QUERY, { login: username, cursor }, customClient);
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
  }

  cache.set(cacheKey, allPRs, 300);
  return allPRs;
}

module.exports = {
  getAllPRs
};

