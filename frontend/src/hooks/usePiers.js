import { useState, useEffect, useCallback } from 'react';
import api from '../api';

export function usePiers() {
  const [piers, setPiers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/piers/').then(r => { setPiers(r.data); setLoading(false); });
  }, []);

  const createPier = useCallback(async (data) => {
    const r = await api.post('/piers/', data);
    setPiers(prev => [...prev, r.data]);
    return r.data;
  }, []);

  const updatePier = useCallback(async (id, data) => {
    const r = await api.patch(`/piers/${id}/`, data);
    setPiers(prev => prev.map(p => p.id === id ? r.data : p));
    return r.data;
  }, []);

  const deletePier = useCallback(async (id) => {
    await api.delete(`/piers/${id}/`);
    setPiers(prev => prev.filter(p => p.id !== id));
  }, []);

  const bulkGenerate = useCallback(async (pierId, data) => {
    const r = await api.post(`/piers/${pierId}/bulk-generate/`, data);
    return r.data;
  }, []);

  return { piers, loading, createPier, updatePier, deletePier, bulkGenerate };
}
