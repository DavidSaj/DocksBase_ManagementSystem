import { useState, useEffect, useCallback } from 'react';
import api from '../api';

export function useBerths(filters = {}) {
  const [berths, setBerths] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams(
      Object.fromEntries(Object.entries(filters).filter(([, v]) => v != null))
    ).toString();
    api
      .get(`/berths/${params ? '?' + params : ''}`)
      .then(r => { setBerths(r.data); setLoading(false); })
      .catch(e => { setError(e); setLoading(false); });
  }, [JSON.stringify(filters)]);

  useEffect(() => { load(); }, [load]);

  const updateBerth = useCallback(async (id, data) => {
    const r = await api.patch(`/berths/${id}/`, data);
    setBerths(prev => prev.map(b => b.id === id ? r.data : b));
    return r.data;
  }, []);

  const createBerth = useCallback(async (data) => {
    const r = await api.post('/berths/', data);
    setBerths(prev => [...prev, r.data]);
    return r.data;
  }, []);

  const deleteBerth = useCallback(async (id) => {
    await api.delete(`/berths/${id}/`);
    setBerths(prev => prev.filter(b => b.id !== id));
  }, []);

  const addBerths = useCallback((newBerths) => {
    setBerths(prev => [...prev, ...newBerths]);
  }, []);

  const counts = berths.reduce((acc, b) => {
    acc[b.status] = (acc[b.status] || 0) + 1;
    acc.total = (acc.total || 0) + 1;
    return acc;
  }, {});

  return { berths, counts, loading, error, reload: load, updateBerth, createBerth, deleteBerth, addBerths };
}
