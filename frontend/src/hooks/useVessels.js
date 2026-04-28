import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function useVessels(filters = {}) {
  const [vessels,  setVessels]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);

  const fetchVessels = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/vessels/', { params: filters });
      setVessels(data.results ?? data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(filters)]);

  useEffect(() => { fetchVessels(); }, [fetchVessels]);

  async function updateVessel(id, patch) {
    const { data } = await api.patch(`/vessels/${id}/`, patch);
    setVessels(prev => prev.map(v => v.id === id ? data : v));
    return data;
  }

  async function createVessel(payload) {
    const { data } = await api.post('/vessels/', payload);
    setVessels(prev => [...prev, data]);
    return data;
  }

  return { vessels, loading, error, refetch: fetchVessels, updateVessel, createVessel };
}
