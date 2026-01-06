/**
 * GitHub API Client
 * 
 * Handles API client setup for both GraphQL and REST APIs.
 * Supports both github.com and GitHub Enterprise instances.
 */

const axios = require('axios');

const GITHUB_USERNAME = process.env.GITHUB_USERNAME;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_BASE_URL = process.env.GITHUB_BASE_URL || 'https://github.com';

if (!GITHUB_USERNAME || !GITHUB_TOKEN) {
  console.warn('GitHub credentials not configured. GitHub stats will not be available.');
}

/**
 * Get GraphQL API URL for given base URL
 */
function getGraphQLURL(baseURL) {
  if (baseURL === 'https://github.com' || baseURL === 'https://www.github.com') {
    return 'https://api.github.com/graphql';
  }
  return baseURL.replace(/\/$/, '') + '/api/graphql';
}

/**
 * Get REST API URL for given base URL
 */
function getRestURL(baseURL) {
  if (baseURL === 'https://github.com' || baseURL === 'https://www.github.com') {
    return 'https://api.github.com';
  }
  return baseURL.replace(/\/$/, '') + '/api/v3';
}

// GraphQL API client
const githubGraphQL = axios.create({
  baseURL: getGraphQLURL(GITHUB_BASE_URL),
  headers: {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Content-Type': 'application/json'
  },
  timeout: 30000
});

// REST API client
const githubApi = axios.create({
  baseURL: getRestURL(GITHUB_BASE_URL),
  headers: {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json'
  },
  timeout: 30000
});

/**
 * Create GraphQL API client with custom credentials
 */
function createGraphQLClient(username, token, baseURL = GITHUB_BASE_URL) {
  return axios.create({
    baseURL: getGraphQLURL(baseURL),
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });
}

/**
 * Create REST API client with custom credentials
 */
function createRestClient(username, token, baseURL = GITHUB_BASE_URL) {
  return axios.create({
    baseURL: getRestURL(baseURL),
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json'
    },
    timeout: 30000
  });
}

/**
 * Execute a GraphQL query
 */
async function graphqlQuery(query, variables = {}, customClient = null) {
  const client = customClient || githubGraphQL;
  const response = await client.post('', { query, variables });
  if (response.data.errors) {
    throw new Error(`GraphQL error: ${response.data.errors[0]?.message}`);
  }
  return response.data.data;
}

// GraphQL Queries
const AUTHORED_PRS_QUERY = `
  query getAuthoredPRs($login: String!, $cursor: String) {
    user(login: $login) {
      pullRequests(first: 100, after: $cursor, orderBy: {field: CREATED_AT, direction: DESC}) {
        nodes {
          id
          number
          title
          state
          createdAt
          updatedAt
          mergedAt
          closedAt
          url
          repository {
            nameWithOwner
            url
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
        totalCount
      }
    }
  }
`;

const CONTRIBUTIONS_QUERY = `
  query getContributions($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        totalPullRequestContributions
        totalPullRequestReviewContributions
        totalCommitContributions
        totalIssueContributions
        pullRequestContributionsByRepository(maxRepositories: 100) {
          repository { nameWithOwner }
          contributions { totalCount }
        }
        pullRequestReviewContributionsByRepository(maxRepositories: 100) {
          repository { nameWithOwner }
          contributions { totalCount }
        }
      }
    }
  }
`;

module.exports = {
  GITHUB_USERNAME,
  GITHUB_TOKEN,
  GITHUB_BASE_URL,
  githubGraphQL,
  githubApi,
  graphqlQuery,
  createGraphQLClient,
  createRestClient,
  AUTHORED_PRS_QUERY,
  CONTRIBUTIONS_QUERY
};
