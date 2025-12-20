/**
 * Common filtering and sorting utilities
 */

/**
 * Create a filter function for items
 */
export function createFilter(filters, filterConfig) {
  return (item) => {
    for (const [key, value] of Object.entries(filters)) {
      if (value === 'all') continue;
      
      const getValue = filterConfig[key];
      if (getValue && getValue(item) !== value) {
        return false;
      }
    }
    return true;
  };
}

/**
 * Create a sort function for items
 */
export function createSorter(sortBy, sortOrder, sortConfig) {
  return (a, b) => {
    const getValue = sortConfig[sortBy] || sortConfig.default;
    if (!getValue) return 0;
    
    let aVal = getValue(a);
    let bVal = getValue(b);
    
    // Handle dates
    if (aVal instanceof Date) aVal = aVal.getTime();
    if (bVal instanceof Date) bVal = bVal.getTime();
    
    // Handle null/undefined
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    
    // Compare
    const comparison = aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
    return sortOrder === 'asc' ? comparison : -comparison;
  };
}

/**
 * Extract unique filter options from items
 */
export function extractFilterOptions(items, optionExtractors) {
  const options = {};
  
  // Ensure items is an array
  if (!Array.isArray(items)) {
    items = [];
  }
  
  for (const [key, extractor] of Object.entries(optionExtractors)) {
    const values = items.map(extractor).filter(Boolean);
    options[key] = [...new Set(values)].sort();
  }
  
  return options;
}

