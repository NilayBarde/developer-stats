// Default date range: July 2025 to present
const DEFAULT_START = new Date('2025-07-01');
const DEFAULT_END = new Date(); // Current date (present)

/**
 * Parse and normalize date range from request parameters
 */
function getDateRange(dateRange) {
  let start, end;
  
  if (dateRange && dateRange.start) {
    start = new Date(dateRange.start);
  } else if (dateRange && dateRange.start === null && dateRange.end === null) {
    // "All Time" - no filtering
    return { start: null, end: null };
  } else {
    start = DEFAULT_START;
  }
  
  if (dateRange && dateRange.end) {
    end = new Date(dateRange.end);
    end.setHours(23, 59, 59, 999); // End of day
  } else if (dateRange && dateRange.end === null && dateRange.start !== null) {
    end = new Date(); // Present
  } else {
    end = DEFAULT_END;
  }
  
  return { start, end };
}

/**
 * Check if a date falls within the specified date range
 */
function isInDateRange(date, dateRange) {
  const range = getDateRange(dateRange);
  if (range.start === null && range.end === null) {
    return true;
  }
  
  const d = new Date(date);
  return !isNaN(d.getTime()) && d >= range.start && d <= range.end;
}

/**
 * Get month key in format YYYY-MM
 * Uses UTC to avoid timezone issues
 */
function getMonthKey(date) {
  const d = new Date(date);
  // Use UTC to match how we generate month ranges
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Get nested property value using dot notation (e.g., 'fields.created')
 */
function getNestedValue(obj, path) {
  return path.split('.').reduce((current, prop) => current?.[prop], obj);
}

/**
 * Filter items by date range
 */
function filterByDateRange(items, dateField = 'created_at', dateRange = null) {
  if (!dateRange || (dateRange.start === null && dateRange.end === null)) {
    return items; // All time - no filtering
  }
  return items.filter(item => {
    const dateValue = dateField.includes('.') 
      ? getNestedValue(item, dateField)
      : item[dateField];
    return isInDateRange(dateValue, dateRange);
  });
}

/**
 * Calculate monthly statistics for items
 */
function calculateMonthlyStats(items, dateField = 'created_at', dateRange = null) {
  const monthly = {};
  const range = getDateRange(dateRange);
  
  // Filter items to date range and calculate monthly stats
  items.forEach(item => {
    const dateStr = dateField.includes('.') 
      ? getNestedValue(item, dateField)
      : item[dateField];
    if (!dateStr) return;
    
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      console.warn(`Invalid date found: ${dateStr}`);
      return;
    }
    
    if (!isInDateRange(date, dateRange)) return;
    
    const monthKey = getMonthKey(date);
    monthly[monthKey] = (monthly[monthKey] || 0) + 1;
  });
  
  // Generate all months in date range (even if count is 0)
  const allMonths = generateMonthRange(range);
  
  // Fill in counts from monthly object
  allMonths.forEach(month => {
    month.count = monthly[month.month] || 0;
  });
  
  // Calculate average per month (only for months with data)
  const monthsWithData = allMonths.filter(m => m.count > 0);
  const avgPerMonth = monthsWithData.length > 0
    ? monthsWithData.reduce((sum, item) => sum + item.count, 0) / monthsWithData.length
    : 0;
  
  return {
    monthly: allMonths,
    averagePerMonth: Math.round(avgPerMonth * 10) / 10
  };
}

/**
 * Generate array of months in date range
 */
function generateMonthRange(range) {
  const allMonths = [];
  
  if (range.start === null && range.end === null) {
    // All time - show last 12 months
    const end = new Date();
    const start = new Date(end.getFullYear(), end.getMonth() - 11, 1);
    for (let d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) {
      const monthKey = getMonthKey(d);
      allMonths.push({
        month: monthKey,
        count: 0 // Will be filled by calculateMonthlyStats
      });
    }
  } else {
    // range.start and range.end are already Date objects from getDateRange
    const startDate = range.start;
    const endDate = range.end || new Date(); // Use current date if end is null
    
    // Use UTC to avoid timezone issues - extract year and month from UTC
    const startYear = startDate.getUTCFullYear();
    const startMonth = startDate.getUTCMonth(); // 0-indexed (0=Jan, 6=Jul)
    const endYear = endDate.getUTCFullYear();
    const endMonth = endDate.getUTCMonth();
    
    // Iterate month by month using UTC
    let currentYear = startYear;
    let currentMonth = startMonth;
    
    while (currentYear < endYear || (currentYear === endYear && currentMonth <= endMonth)) {
      const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
      allMonths.push({
        month: monthKey,
        count: 0 // Will be filled by calculateMonthlyStats
      });
      
      // Move to next month
      currentMonth++;
      if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
      }
    }
  }
  
  return allMonths;
}

/**
 * Calculate time period stats (last 30/90 days)
 */
function calculateTimePeriodStats(items, dateField = 'created_at') {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  return {
    last30Days: items.filter(item => {
      const dateValue = dateField.includes('.') 
        ? getNestedValue(item, dateField)
        : item[dateField];
      return new Date(dateValue) >= thirtyDaysAgo;
    }).length,
    last90Days: items.filter(item => {
      const dateValue = dateField.includes('.') 
        ? getNestedValue(item, dateField)
        : item[dateField];
      return new Date(dateValue) >= ninetyDaysAgo;
    }).length
  };
}

/**
 * Format date range for API response
 */
function formatDateRangeForResponse(dateRange) {
  if (!dateRange) {
    return {
      start: DEFAULT_START.toISOString().split('T')[0],
      end: DEFAULT_END.toISOString().split('T')[0]
    };
  }
  
  return {
    start: dateRange.start || null,
    end: dateRange.end || null
  };
}

module.exports = {
  getDateRange,
  isInDateRange,
  getMonthKey,
  filterByDateRange,
  calculateMonthlyStats,
  generateMonthRange,
  calculateTimePeriodStats,
  formatDateRangeForResponse,
  DEFAULT_START,
  DEFAULT_END
};

