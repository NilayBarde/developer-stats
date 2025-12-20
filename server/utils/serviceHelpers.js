/**
 * Common service helper functions
 */

const { filterByDateRange } = require('./dateHelpers');

/**
 * Filter and sort items for page display
 * @param {Array} items - Items to filter and sort
 * @param {Object} dateRange - Optional date range filter
 * @param {Function} transformFn - Optional function to transform each item
 * @returns {Array} Filtered and sorted items
 */
function prepareItemsForPage(items, dateRange = null, transformFn = null) {
  // Filter by date range
  let filtered = dateRange 
    ? filterByDateRange(items, 'created_at', dateRange)
    : items;
  
  // Transform items if function provided
  if (transformFn) {
    filtered = filtered.map(transformFn);
  }
  
  // Sort by updated date descending
  filtered.sort((a, b) => {
    const dateA = new Date(a.updated_at || a.created_at || 0);
    const dateB = new Date(b.updated_at || b.created_at || 0);
    return dateB - dateA;
  });
  
  return filtered;
}

module.exports = {
  prepareItemsForPage
};

