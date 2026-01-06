/**
 * GitLab Helper Functions
 * Utilities for building GitLab API parameters
 */

/**
 * Build GitLab API date range parameters
 * @param {Object|null} dateRange - Date range object with start and/or end properties
 * @returns {Object} Object with created_after and/or created_before properties
 * 
 * Note: GitLab's created_before is exclusive, so we add 1 day to make it inclusive
 * to match the expected behavior (include the full end date).
 */
function buildGitLabDateParams(dateRange) {
  const params = {};

  if (!dateRange) {
    return params;
  }

  if (dateRange.start) {
    params.created_after = dateRange.start;
  }

  if (dateRange.end) {
    // GitLab's created_before is exclusive, so add 1 day to include the full end date
    const endDate = new Date(dateRange.end);
    endDate.setDate(endDate.getDate() + 1);
    params.created_before = endDate.toISOString().split('T')[0];
  }

  return params;
}

module.exports = {
  buildGitLabDateParams
};

