/**
 * GitLab API Client
 * 
 * Handles API client setup for both GraphQL and REST APIs.
 */

const axios = require('axios');

const GITLAB_USERNAME = process.env.GITLAB_USERNAME;
const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
const GITLAB_BASE_URL = process.env.GITLAB_BASE_URL || 'https://gitlab.com';

if (!GITLAB_USERNAME || !GITLAB_TOKEN) {
  console.warn('GitLab credentials not configured. GitLab stats will not be available.');
}

// REST API client
const gitlabApi = axios.create({
  baseURL: `${GITLAB_BASE_URL}/api/v4`,
  headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN },
  timeout: 30000
});

// GraphQL API client
const gitlabGraphQL = axios.create({
  baseURL: `${GITLAB_BASE_URL}/api`,
  headers: { 
    'Authorization': `Bearer ${GITLAB_TOKEN}`,
    'Content-Type': 'application/json'
  },
  timeout: 30000
});

/**
 * Execute a GraphQL query
 */
async function graphqlQuery(query, variables = {}) {
  const response = await gitlabGraphQL.post('/graphql', { query, variables });
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
  AUTHORED_MRS_QUERY,
  GITLAB_ACTIONS
};
