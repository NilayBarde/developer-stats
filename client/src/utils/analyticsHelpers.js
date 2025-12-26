/**
 * Shared analytics utility functions
 */

/**
 * Format large numbers for display (e.g., 1.5K, 2.3M)
 */
export function formatNumber(num) {
  if (num == null) return '0';
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

/**
 * Format date string to short display format (e.g., "Dec 15")
 * Uses UTC to avoid timezone issues with ISO dates
 */
export function formatShortDate(dateStr) {
  // For ISO dates (2025-12-01), parse as UTC to avoid timezone shift
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    const [year, month, day] = dateStr.split('T')[0].split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      timeZone: 'UTC'
    });
  }
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Format date string to full display format (e.g., "Dec 15, 2025")
 * Uses UTC to avoid timezone issues with ISO dates
 */
export function formatFullDate(dateStr) {
  // For ISO dates (2025-12-01), parse as UTC to avoid timezone shift
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    const [year, month, day] = dateStr.split('T')[0].split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      timeZone: 'UTC'
    });
  }
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Parse a date string and return a Date object at noon UTC
 * This avoids timezone issues when comparing dates
 * Handles both ISO format (2025-12-01) and human format (Dec 1, 2025)
 */
export function parseDate(dateStr) {
  if (!dateStr) return null;
  
  // If it's ISO format (contains - and looks like YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return new Date(dateStr.split('T')[0] + 'T12:00:00Z');
  }
  
  // Otherwise parse as human-readable date (e.g., "Dec 1, 2025")
  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) return null;
  
  // Normalize to noon UTC to avoid timezone issues
  return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 12, 0, 0));
}

/**
 * Check if a date is after the launch date
 */
export function isAfterLaunch(dateStr, launchDate) {
  if (!launchDate) return false;
  const date = parseDate(dateStr);
  const launch = parseDate(launchDate);
  return date && launch && date >= launch;
}

/**
 * Convert daily clicks object/map to sorted array
 * Uses parseDate for consistent timezone handling
 * @param {Object} dailyClicks - Object with date keys and click data values
 * @param {Object} dateRange - Optional { start, end } to fill in missing dates with 0
 */
export function dailyClicksToArray(dailyClicks, dateRange = null) {
  if (!dailyClicks) return [];
  
  // If no date range provided, just convert existing data
  if (!dateRange) {
    return Object.entries(dailyClicks)
      .map(([date, data]) => ({
        date,
        clicks: data?.clicks || data || 0
      }))
      .sort((a, b) => {
        const dateA = parseDate(a.date);
        const dateB = parseDate(b.date);
        return (dateA?.getTime() || 0) - (dateB?.getTime() || 0);
      });
  }
  
  // Fill in all dates in range, using 0 for missing dates
  const result = [];
  const startDate = parseDate(dateRange.start);
  const endDate = parseDate(dateRange.end);
  
  if (!startDate || !endDate) {
    // Fallback to simple conversion if dates invalid
    return Object.entries(dailyClicks)
      .map(([date, data]) => ({
        date,
        clicks: data?.clicks || data || 0
      }))
      .sort((a, b) => {
        const dateA = parseDate(a.date);
        const dateB = parseDate(b.date);
        return (dateA?.getTime() || 0) - (dateB?.getTime() || 0);
      });
  }
  
  // Normalize dailyClicks keys to ISO format for lookup
  const normalizedClicks = {};
  Object.entries(dailyClicks).forEach(([date, data]) => {
    const isoDate = parseToISO(date);
    normalizedClicks[isoDate] = data?.clicks || data || 0;
  });
  
  // Iterate through each day in range
  const current = new Date(startDate);
  while (current <= endDate) {
    const isoDate = current.toISOString().split('T')[0];
    result.push({
      date: isoDate,
      clicks: normalizedClicks[isoDate] || 0
    });
    current.setDate(current.getDate() + 1);
  }
  
  return result;
}

/**
 * Convert daily data array to sorted array (handles both pageViews and clicks)
 * Uses parseDate for consistent timezone handling
 */
export function normalizeDailyData(dailyData) {
  if (!dailyData || !Array.isArray(dailyData)) return [];
  
  return [...dailyData].sort((a, b) => {
    const dateA = parseDate(a.date);
    const dateB = parseDate(b.date);
    return (dateA?.getTime() || 0) - (dateB?.getTime() || 0);
  });
}

/**
 * Calculate the index of labels to show on x-axis (for readability)
 */
export function getLabelInterval(dataLength, maxLabels = 8) {
  return Math.max(1, Math.floor(dataLength / maxLabels));
}

/**
 * Check if a project is still loading (no data yet)
 */
export function isProjectLoading(project) {
  if (project.error) return false;
  if (project.clicks !== undefined) return false;
  if (project.dailyData !== undefined) return false;
  if (project.totalClicks !== undefined) return false;
  return true;
}

/**
 * Default launch date constant
 */
export const DEFAULT_LAUNCH_DATE = '2025-12-01';

/**
 * Parse date string to ISO format (YYYY-MM-DD) for comparison
 * Handles both ISO format and human-readable format (Mar 1, 2025)
 */
export function parseToISO(dateStr) {
  // Already ISO format (2025-03-01)
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  // Human format (Mar 1, 2025)
  const d = new Date(dateStr);
  if (!isNaN(d)) {
    return d.toISOString().split('T')[0];
  }
  return dateStr;
}

/**
 * Get comparison data between before and after launch
 */
export function calculateComparison(dailyData, launchDate, valueKey = 'clicks') {
  if (!dailyData || dailyData.length === 0 || !launchDate) return null;

  const launchDateObj = parseDate(launchDate);
  const beforeData = dailyData.filter(d => parseDate(d.date) < launchDateObj);
  const afterData = dailyData.filter(d => parseDate(d.date) >= launchDateObj);

  const sumBefore = beforeData.reduce((sum, d) => sum + (d[valueKey] || 0), 0);
  const sumAfter = afterData.reduce((sum, d) => sum + (d[valueKey] || 0), 0);

  const avgBefore = beforeData.length > 0 ? Math.round(sumBefore / beforeData.length) : 0;
  const avgAfter = afterData.length > 0 ? Math.round(sumAfter / afterData.length) : 0;

  const changePercent = avgBefore > 0
    ? Math.round(((avgAfter - avgBefore) / avgBefore) * 100)
    : avgAfter > 0 ? 100 : 0;

  return {
    avgBefore,
    avgAfter,
    daysBefore: beforeData.length,
    daysAfter: afterData.length,
    changePercent
  };
}

