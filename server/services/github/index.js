/**
 * GitHub Service
 * 
 * Orchestrator module that re-exports all GitHub service functions.
 * 
 * EXPORTS:
 * - getStats(dateRange) - Main stats with contributions + PR list
 * - getAllPRsForPage(dateRange) - PR list for PRs page
 * - getReviewComments(dateRange) - Review comment statistics
 * - getContributionStats(dateRange) - Contribution stats only
 */

const { prepareItemsForPage } = require('../../utils/serviceHelpers');
const { getAllPRs } = require('./prs');
const { getStats, getContributionStats } = require('./stats');
const { getReviewComments } = require('./comments');

/**
 * Get all PRs for the PRs page with date filtering
 */
async function getAllPRsForPage(dateRange = null) {
  const prs = await getAllPRs();
  return prepareItemsForPage(prs, dateRange);
}

// Re-export all functions
module.exports = {
  getStats,
  getAllPRsForPage,
  getReviewComments,
  getContributionStats
};
