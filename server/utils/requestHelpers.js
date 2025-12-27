/**
 * Parse date range from request query parameters
 * @param {Object} query - Express request query object
 * @returns {Object|null} Date range object or null
 */
function parseDateRange(query) {
  if (query.start || query.end) {
    return {
      start: query.start || null,
      end: query.end || null
    };
  }
  
  if (query.range) {
    const now = new Date();
    switch (query.range) {
      case 'last6months': {
        const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);
        return { start: sixMonthsAgo.toISOString().split('T')[0], end: null };
      }
      case 'last12months': {
        const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 12, 1);
        return { start: twelveMonthsAgo.toISOString().split('T')[0], end: null };
      }
      case 'alltime':
        return { start: null, end: null };
      default:
        return null;
    }
  }
  
  return null;
}

/**
 * Set standard cache headers for API responses
 * @param {Object} res - Express response object
 * @param {boolean} isHit - Whether this was a cache hit
 */
function setCacheHeaders(res, isHit = false) {
  // Allow browser to cache for 60 seconds, but require revalidation after that
  res.set('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=30');
  res.set('X-Cache', isHit ? 'HIT' : 'MISS');
}

/**
 * Create async route handler with error handling
 * @param {Function} fn - Async route handler
 * @returns {Function} Express middleware
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  parseDateRange,
  setCacheHeaders,
  asyncHandler
};

