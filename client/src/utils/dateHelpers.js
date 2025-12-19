/**
 * Get the start date of the current work year (September to August)
 * Work year runs from September to August
 */
export function getCurrentWorkYearStart() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-11, where 8 = September
  
  if (currentMonth >= 8) {
    // September or later - work year started this September
    return new Date(currentYear, 8, 1).toISOString().split('T')[0];
  } else {
    // Before September - work year started last September
    return new Date(currentYear - 1, 8, 1).toISOString().split('T')[0];
  }
}

/**
 * Format work year label
 */
export function formatWorkYearLabel(startDate) {
  // Parse date string and format using UTC to avoid timezone issues
  const [year, month, day] = startDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day)); // month is 0-indexed
  
  // Format using UTC methods to avoid timezone conversion
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = monthNames[date.getUTCMonth()];
  const yearStr = date.getUTCFullYear();
  
  return `Current Work Year (${monthName} ${yearStr} - Present)`;
}

