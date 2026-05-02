import { useState, useEffect, useCallback } from 'react';
import api from '../api';

export function usePrefabs() {
  const [prefabs, setPrefabs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    api.get('/prefabs/')
      .then(r => { setPrefabs(r.data); setLoading(false); })
      .catch(e => { setError(e); setLoading(false); });
  }, []);

  const createPrefab = useCallback(async (data) => {
    const r = await api.post('/prefabs/', data);
    setPrefabs(prev => [...prev, r.data]);
    return r.data;
  }, []);

  const deletePrefab = useCallback(async (id) => {
    await api.delete(`/prefabs/${id}/`);
    setPrefabs(prev => prev.filter(p => p.id !== id));
  }, []);

  return { prefabs, loading, error, createPrefab, deletePrefab };
}
