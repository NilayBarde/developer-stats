/**
 * Get the start date of the current work year (October to September)
 * Work year runs from October to September
 */
export function getCurrentWorkYearStart() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-11, where 9 = October
  
  if (currentMonth >= 9) {
    // October or later - work year started this October
    return new Date(currentYear, 9, 1).toISOString().split('T')[0];
  } else {
    // Before October - work year started last October
    return new Date(currentYear - 1, 9, 1).toISOString().split('T')[0];
  }
}

/**
 * Format work year label
 */
export function formatWorkYearLabel(startDate) {
  const date = new Date(startDate);
  return `Current Work Year (${date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} - Present)`;
}

