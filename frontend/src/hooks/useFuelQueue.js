import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function useFuelQueue() {
  const [queue,   setQueue]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const fetchQueue = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/fuel-dock/queue/', { params: { active: 1 } });
      setQueue(data.results ?? data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  async function addToQueue(payload) {
    const { data } = await api.post('/fuel-dock/queue/', payload);
    setQueue(prev => [...prev, data]);
    return data;
  }

  async function advanceEntry(id, patch) {
    const { data } = await api.patch(`/fuel-dock/queue/${id}/`, patch);
    setQueue(prev => prev.map(e => e.id === id ? data : e).filter(e => e.status !== 'completed'));
    return data;
  }

  async function removeEntry(id) {
    await api.delete(`/fuel-dock/queue/${id}/`);
    setQueue(prev => prev.filter(e => e.id !== id));
  }

  return { queue, loading, error, refetch: fetchQueue, addToQueue, advanceEntry, removeEntry };
}
