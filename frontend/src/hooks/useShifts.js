import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function useShifts(weekStart) {
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchShifts = useCallback(async () => {
    try {
      setLoading(true);
      const params = weekStart ? { week_start: weekStart } : {};
      const { data } = await api.get('/shifts/', { params });
      setShifts(data.results ?? data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => { fetchShifts(); }, [fetchShifts]);

  async function createShift(payload) {
    const { data } = await api.post('/shifts/', payload);
    setShifts(prev => [...prev, data]);
    return data;
  }

  async function updateShift(id, payload) {
    const { data } = await api.patch(`/shifts/${id}/`, payload);
    setShifts(prev => prev.map(s => s.id === id ? data : s));
    return data;
  }

  async function deleteShift(id) {
    await api.delete(`/shifts/${id}/`);
    setShifts(prev => prev.filter(s => s.id !== id));
  }

  return { shifts, loading, error, refetch: fetchShifts, createShift, updateShift, deleteShift };
}
