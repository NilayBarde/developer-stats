/**
 * GitLab API Client
 * 
 * Handles API client setup for both GraphQL and REST APIs.
 */

const { createApiClient } = require('../../utils/apiHelpers');

const GITLAB_USERNAME = process.env.GITLAB_USERNAME;
const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
const GITLAB_BASE_URL = process.env.GITLAB_BASE_URL || 'https://gitlab.com';

if (!GITLAB_USERNAME || !GITLAB_TOKEN) {
  console.warn('GitLab credentials not configured. GitLab stats will not be available.');
}

// REST API client - GitLab uses PRIVATE-TOKEN header
const gitlabApi = GITLAB_TOKEN && GITLAB_BASE_URL ? createApiClient({
  baseURL: `${GITLAB_BASE_URL}/api/v4`,
  token: GITLAB_TOKEN,
  authType: 'Token',
  authHeader: 'PRIVATE-TOKEN'
}) : null;

// GraphQL API client - GitLab uses Bearer token
const gitlabGraphQL = GITLAB_TOKEN && GITLAB_BASE_URL ? createApiClient({
  baseURL: `${GITLAB_BASE_URL}/api`,
  token: GITLAB_TOKEN,
  authType: 'Bearer'
}) : null;

/**
 * Create REST API client with custom credentials
 */
function createRestClient(username, token, baseURL = GITLAB_BASE_URL) {
  return createApiClient({
    baseURL: `${baseURL}/api/v4`,
    token: token,
    authType: 'Token',
    authHeader: 'PRIVATE-TOKEN'
  });
}

/**
 * Create GraphQL API client with custom credentials
 */
function createGraphQLClient(username, token, baseURL = GITLAB_BASE_URL) {
  return createApiClient({
    baseURL: `${baseURL}/api`,
    token: token,
    authType: 'Bearer'
  });
}

/**
 * Execute a GraphQL query
 */
async function graphqlQuery(query, variables = {}, customClient = null) {
  const client = customClient || gitlabGraphQL;
  const response = await client.post('/graphql', { query, variables });
  if (response.data.errors) {
    throw new Error(`GraphQL error: ${response.data.errors[0]?.message}`);
  }
  return response.data.data;
}

// GraphQL Queries
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

// Constants
const GITLAB_ACTIONS = ['commented', 'created', 'merged', 'approved'];

module.exports = {
  GITLAB_USERNAME,
  GITLAB_TOKEN,
  GITLAB_BASE_URL,
  gitlabApi,
  gitlabGraphQL,
  graphqlQuery,
  createRestClient,
  createGraphQLClient,
  AUTHORED_MRS_QUERY,
  GITLAB_ACTIONS
};
