/**
 * User Helpers
 * 
 * Utilities for loading users from engineering-metrics or config file
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * Fetch users from engineering-metrics API
 * @param {string} apiUrl - Engineering-metrics API URL (e.g., "https://engineering-metrics.example.com/api/users")
 * @returns {Promise<Array>} Array of user objects
 */
async function fetchUsersFromEngineeringMetrics(apiUrl) {
  try {
    const response = await axios.get(apiUrl, {
      timeout: 10000,
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (Array.isArray(response.data)) {
      return response.data;
    } else if (response.data.users && Array.isArray(response.data.users)) {
      return response.data.users;
    } else if (response.data.data && Array.isArray(response.data.data)) {
      return response.data.data;
    }
    
    console.warn('Engineering-metrics API returned unexpected format');
    return [];
  } catch (error) {
    console.error('Failed to fetch users from engineering-metrics:', error.message);
    return null;
  }
}

/**
 * Load users from a local file
 * @param {string} filePath - Path to users file (JSON)
 * @returns {Promise<Array>} Array of user objects
 */
async function loadUsersFromFile(filePath) {
  try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, '..', filePath);
    const fileContent = fs.readFileSync(fullPath, 'utf8');
    const users = JSON.parse(fileContent);
    return Array.isArray(users) ? users : [];
  } catch (error) {
    console.error(`Failed to load users from file ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Extract users directly from engineering-metrics source files
 * Uses the extractUsersFromEngineeringMetrics utility
 * @param {string} emPath - Path to engineering-metrics directory
 * @returns {Promise<Array>} Array of user objects
 */
async function loadUsersFromEngineeringMetricsFiles(emPath) {
  try {
    const { extractGitHubUsers, extractGitLabUsers, extractJiraUsers, mergeUsers } = require('./extractUsersFromEngineeringMetrics');
    
    const githubUsers = extractGitHubUsers(emPath);
    const gitlabUsers = extractGitLabUsers(emPath);
    const jiraUsers = extractJiraUsers(emPath);
    
    const mergedUsers = mergeUsers(githubUsers, gitlabUsers, jiraUsers);
    return mergedUsers;
  } catch (error) {
    console.error(`Failed to extract users from engineering-metrics files:`, error.message);
    return null;
  }
}

/**
 * Get users from engineering-metrics or fallback to config file
 * Priority:
 * 1. Engineering-metrics API (if ENGINEERING_METRICS_USERS_URL is set)
 * 2. Engineering-metrics file (if ENGINEERING_METRICS_USERS_FILE is set)
 * 3. Engineering-metrics source files (if ENGINEERING_METRICS_PATH is set)
 * 4. Default config file (server/config/users.json)
 * 
 * @returns {Promise<Array>} Array of user objects
 */
async function getUsers() {
  const engineeringMetricsUrl = process.env.ENGINEERING_METRICS_USERS_URL;
  const engineeringMetricsFile = process.env.ENGINEERING_METRICS_USERS_FILE;
  const engineeringMetricsPath = process.env.ENGINEERING_METRICS_PATH;
  
  // Try engineering-metrics API first
  if (engineeringMetricsUrl) {
    console.log(`📡 Fetching users from engineering-metrics API: ${engineeringMetricsUrl}`);
    const users = await fetchUsersFromEngineeringMetrics(engineeringMetricsUrl);
    if (users && users.length > 0) {
      console.log(`✓ Loaded ${users.length} users from engineering-metrics API`);
      return users;
    }
  }
  
  // Try engineering-metrics file
  if (engineeringMetricsFile) {
    console.log(`📄 Loading users from engineering-metrics file: ${engineeringMetricsFile}`);
    const users = await loadUsersFromFile(engineeringMetricsFile);
    if (users && users.length > 0) {
      console.log(`✓ Loaded ${users.length} users from engineering-metrics file`);
      return users;
    }
  }
  
  // Try extracting directly from engineering-metrics source files
  if (engineeringMetricsPath) {
    console.log(`📂 Extracting users from engineering-metrics source files: ${engineeringMetricsPath}`);
    const users = await loadUsersFromEngineeringMetricsFiles(engineeringMetricsPath);
    if (users && users.length > 0) {
      console.log(`✓ Extracted ${users.length} users from engineering-metrics source files`);
      return users;
    }
  }
  
  // Fallback to default config file
  try {
    const usersConfig = require('../config/users.json');
    const users = Array.isArray(usersConfig) ? usersConfig : [];
    if (users.length > 0) {
      console.log(`✓ Loaded ${users.length} users from config file`);
    }
    return users;
  } catch (error) {
    console.error('Failed to load users from config file:', error.message);
    return [];
  }
}

/**
 * Transform engineering-metrics user format to our format
 * Engineering-metrics might return users in different formats, so we normalize them
 * 
 * Expected engineering-metrics format (one of):
 * - { id: "user1", github: "username", gitlab: "username", jira: "email@example.com" }
 * - { username: "user1", githubUsername: "...", gitlabUsername: "...", jiraEmail: "..." }
 * - { name: "user1", github: { username: "..." }, gitlab: { username: "..." }, jira: { email: "..." } }
 * 
 * @param {Object} emUser - User object from engineering-metrics
 * @returns {Object} Normalized user object
 */
function normalizeEngineeringMetricsUser(emUser) {
  // If already in our format, return as-is
  if (emUser.id && (emUser.github?.username || emUser.gitlab?.username || emUser.jira?.email)) {
    return emUser;
  }
  
  // Try to extract from various possible formats
  const normalized = {
    id: emUser.id || emUser.username || emUser.name || emUser.userId || 'unknown'
  };
  
  // GitHub
  if (emUser.github?.username) {
    normalized.github = { username: emUser.github.username };
  } else if (emUser.githubUsername || emUser.github) {
    normalized.github = { username: emUser.githubUsername || emUser.github };
  }
  
  // GitLab
  if (emUser.gitlab?.username) {
    normalized.gitlab = { username: emUser.gitlab.username };
  } else if (emUser.gitlabUsername || emUser.gitlab) {
    normalized.gitlab = { username: emUser.gitlabUsername || emUser.gitlab };
  }
  
  // Jira
  if (emUser.jira?.email) {
    normalized.jira = { email: emUser.jira.email };
  } else if (emUser.jiraEmail || emUser.jira) {
    normalized.jira = { email: emUser.jiraEmail || emUser.jira };
  }
  
  return normalized;
}

module.exports = {
  getUsers,
  fetchUsersFromEngineeringMetrics,
  loadUsersFromFile,
  loadUsersFromEngineeringMetricsFiles,
  normalizeEngineeringMetricsUser
};

