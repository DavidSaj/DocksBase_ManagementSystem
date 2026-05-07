import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function useBerthCategories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/berths/berth-categories/');
      setCategories(data.results ?? data);
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const save = useCallback(async (payload, id = null) => {
    if (id) {
      const { data } = await api.patch(`/berths/berth-categories/${id}/`, payload);
      setCategories(prev => prev.map(c => c.id === id ? data : c));
      return data;
    }
    const { data } = await api.post('/berths/berth-categories/', payload);
    setCategories(prev => [...prev, data]);
    return data;
  }, []);

  const remove = useCallback(async (id) => {
    await api.delete(`/berths/berth-categories/${id}/`);
    setCategories(prev => prev.filter(c => c.id !== id));
  }, []);

  return { categories, loading, error, save, remove, refresh: fetch };
}
