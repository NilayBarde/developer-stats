/**
 * Simple client-side cache for API responses
 * Prevents unnecessary refetches when navigating between pages
 */

class ClientCache {
  constructor() {
    this.cache = new Map();
    this.defaultTTL = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Generate cache key from endpoint and dateRange
   */
  getKey(endpoint, dateRange) {
    const dateRangeStr = dateRange ? JSON.stringify(dateRange) : 'all';
    return `${endpoint}:${dateRangeStr}`;
  }

  /**
   * Get cached data if it exists and hasn't expired
   */
  get(endpoint, dateRange) {
    const key = this.getKey(endpoint, dateRange);
    const item = this.cache.get(key);
    
    if (!item) return null;
    
    // Check if expired
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    return item.data;
  }

  /**
   * Set cached data
   */
  set(endpoint, dateRange, data, ttl = null) {
    const key = this.getKey(endpoint, dateRange);
    const expiresAt = Date.now() + (ttl || this.defaultTTL);
    
    this.cache.set(key, {
      data,
      expiresAt
    });
  }

  /**
   * Clear cache for a specific endpoint or all cache
   */
  clear(endpoint = null, dateRange = null) {
    if (endpoint) {
      const key = this.getKey(endpoint, dateRange);
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Clean up expired entries
   */
  cleanup() {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}

// Singleton instance
const clientCache = new ClientCache();

// Clean up expired entries every minute
if (typeof window !== 'undefined') {
  setInterval(() => clientCache.cleanup(), 60 * 1000);
}

export default clientCache;

