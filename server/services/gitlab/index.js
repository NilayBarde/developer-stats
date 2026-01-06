/**
 * GitLab Service
 * 
 * Orchestrator module that re-exports all GitLab service functions.
 * 
 * EXPORTS:
 * - getStats(dateRange) - Main stats with events + MR list
 * - getAllMRsForPage(dateRange) - MR list for MRs page
 * - getReviewComments(dateRange) - Review comment statistics
 * - getActionStats(dateRange) - Action stats only
 */

const { prepareItemsForPage } = require('../../utils/serviceHelpers');
const { getAllMergeRequests } = require('./mrs');
const { getStats } = require('./stats');
const { getReviewComments } = require('./comments');
const { getActionStats } = require('./events');

/**
 * Get all MRs for the MRs page with date filtering
 */
async function getAllMRsForPage(dateRange = null) {
  const mrs = await getAllMergeRequests();
  const transformFn = (mr) => ({ ...mr, _projectName: mr._projectPath || 'unknown' });
  return prepareItemsForPage(mrs, dateRange, transformFn);
}

// Re-export all functions
module.exports = {
  getStats,
  getAllMRsForPage,
  getReviewComments,
  getActionStats
};
