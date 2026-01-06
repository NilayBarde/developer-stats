/**
 * Jira Helper Functions
 * Utilities for building JQL queries and date filters
 */

/**
 * Build a JQL date filter clause
 * @param {Object|null} dateRange - Date range object with start and/or end properties
 * @param {string} fieldName - Jira field name to filter on (e.g., 'updated', 'resolutiondate')
 * @returns {string} JQL date filter clause, or empty string if no date range
 */
function buildJqlDateFilter(dateRange, fieldName) {
  if (!dateRange) {
    return '';
  }

  if (dateRange.start && dateRange.end) {
    return `${fieldName} >= "${dateRange.start}" AND ${fieldName} <= "${dateRange.end}"`;
  } else if (dateRange.start) {
    return `${fieldName} >= "${dateRange.start}"`;
  } else if (dateRange.end) {
    return `${fieldName} <= "${dateRange.end}"`;
  }

  return '';
}

/**
 * Build a complete JQL query by combining base clause with filters
 * @param {string} baseClause - Base JQL clause (e.g., 'assignee = "user@example.com"')
 * @param {Array<string>} filters - Array of filter clauses to AND together (empty strings are ignored)
 * @param {string} orderBy - ORDER BY clause (e.g., 'ORDER BY updated DESC')
 * @returns {string} Complete JQL query
 */
function buildJqlQuery(baseClause, filters, orderBy) {
  const activeFilters = filters.filter(f => f && f.trim() !== '');
  const filterClause = activeFilters.length > 0 
    ? ` AND ${activeFilters.join(' AND ')}`
    : '';
  
  return `${baseClause}${filterClause} ${orderBy}`;
}

module.exports = {
  buildJqlDateFilter,
  buildJqlQuery
};

