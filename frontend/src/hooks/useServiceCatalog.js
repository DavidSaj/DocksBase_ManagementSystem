import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function useServiceCatalog(category, options = {}) {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      const params = {};
      if (category) params.category = category;
      if (options.isActive) params.is_active = true;
      const { data } = await api.get('/billing/service-catalog/', { params });
      setItems(data.results ?? data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [category, options.isActive]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const createItem = useCallback(async (payload) => {
    const { data } = await api.post('/billing/service-catalog/', payload);
    setItems(prev => [...prev, data]);
    return data;
  }, []);

  const updateItem = useCallback(async (id, payload) => {
    const { data } = await api.patch(`/billing/service-catalog/${id}/`, payload);
    setItems(prev => prev.map(i => i.id === id ? data : i));
    return data;
  }, []);

  const deactivateItem = useCallback(async (id) => {
    const { data } = await api.patch(`/billing/service-catalog/${id}/`, { is_active: false });
    setItems(prev => prev.map(i => i.id === id ? data : i));
    return data;
  }, []);

  return { items, loading, error, refetch: fetchItems, createItem, updateItem, deactivateItem };
}
