/**
 * Common endpoint handler utilities
 */

const cache = require('./cache');
const { parseDateRange, setCacheHeaders } = require('./requestHelpers');

/**
 * Create a cached endpoint handler
 * @param {Object} options - Handler options
 * @param {string} options.cacheKeyPrefix - Prefix for cache key
 * @param {Function} options.fetchFn - Async function to fetch data
 * @param {number} options.ttl - Cache TTL in seconds (default: 300)
 * @param {Function} options.transformResponse - Optional function to transform response
 */
function createCachedEndpoint({ cacheKeyPrefix, fetchFn, ttl = 300, transformResponse }) {
  return async (req, res) => {
    try {
      const dateRange = parseDateRange(req.query);
      const cacheKey = `${cacheKeyPrefix}:${JSON.stringify(dateRange)}`;
      
      const cached = cache.get(cacheKey);
      if (cached) {
        setCacheHeaders(res, true);
        return res.json(cached);
      }
      
      const startTime = Date.now();
      const data = await fetchFn(dateRange);
      
      let response = transformResponse ? transformResponse(data) : data;
      
      cache.set(cacheKey, response, ttl);
      const itemCount = Array.isArray(data) ? data.length : (data.items?.length || 0);
      
      setCacheHeaders(res, false);
      res.json(response);
    } catch (error) {
      console.error(`Error fetching ${cacheKeyPrefix}:`, error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      }
    }
  };
}

/**
 * Create a simple endpoint handler (no caching)
 */
function createSimpleEndpoint({ fetchFn, transformResponse }) {
  return async (req, res) => {
    try {
      const dateRange = parseDateRange(req.query);
      const data = await fetchFn(dateRange);
      const response = transformResponse ? transformResponse(data) : data;
      res.json(response);
    } catch (error) {
      console.error('Error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      }
    }
  };
}

module.exports = {
  createCachedEndpoint,
  createSimpleEndpoint
};

