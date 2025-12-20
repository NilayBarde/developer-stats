/**
 * Shared hook for page data fetching pattern
 */
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { buildApiUrl } from '../utils/apiHelpers';

/**
 * Hook for fetching page data (items + stats)
 * @param {Object} config - Configuration object
 * @param {string|Array<string>} config.itemsEndpoint - Endpoint(s) for fetching items
 * @param {string} config.statsEndpoint - Endpoint for fetching stats
 * @param {Object} config.dateRange - Current date range
 * @param {Function} config.transformItems - Optional function to transform items
 */
export function usePageData({ itemsEndpoint, statsEndpoint, dateRange, transformItems }) {
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const endpoints = Array.isArray(itemsEndpoint) ? itemsEndpoint : [itemsEndpoint];
      const responses = await Promise.all(
        endpoints.map(endpoint => axios.get(buildApiUrl(endpoint, dateRange)))
      );
      
      let allItems = [];
      responses.forEach((response, index) => {
        const endpoint = endpoints[index];
        let responseItems = [];
        
        if (endpoint.includes('/prs')) {
          responseItems = (response.data.prs || []).map(item => ({ ...item, _source: 'github' }));
        } else if (endpoint.includes('/mrs')) {
          responseItems = (response.data.mrs || []).map(item => ({ ...item, _source: 'gitlab' }));
        } else if (endpoint.includes('/issues')) {
          responseItems = response.data.issues || [];
        } else {
          responseItems = response.data.items || response.data || [];
        }
        
        allItems = [...allItems, ...responseItems];
      });
      
      setItems(transformItems ? transformItems(allItems) : allItems);
    } catch (err) {
      setError('Failed to fetch data. Please check your API configuration.');
      console.error('Error fetching items:', err);
    } finally {
      setLoading(false);
    }
  }, [itemsEndpoint, dateRange, transformItems]);

  const fetchStats = useCallback(async () => {
    if (!statsEndpoint) return;
    
    try {
      setStatsLoading(true);
      const response = await axios.get(buildApiUrl(statsEndpoint, dateRange));
      setStats(response.data);
    } catch (err) {
      console.error('Error fetching stats:', err);
    } finally {
      setStatsLoading(false);
    }
  }, [statsEndpoint, dateRange]);

  useEffect(() => {
    fetchItems();
    fetchStats();
  }, [fetchItems, fetchStats]);

  return {
    items,
    stats,
    loading,
    statsLoading,
    error,
    refetch: fetchItems
  };
}

