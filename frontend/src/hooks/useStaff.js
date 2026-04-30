import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function useStaff() {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchStaff = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/staff/');
      setStaff(data.results ?? data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStaff(); }, [fetchStaff]);

  async function inviteStaff(payload) {
    const { data } = await api.post('/staff/invite/', payload);
    setStaff(prev => [...prev, data]);
    return data;
  }

  async function updateStaff(id, payload) {
    const { data } = await api.patch(`/staff/${id}/`, payload);
    setStaff(prev => prev.map(s => s.id === id ? data : s));
    return data;
  }

  async function deactivateStaff(id) {
    const data = await updateStaff(id, { is_active: false });
    return data;
  }

  return { staff, loading, error, refetch: fetchStaff, inviteStaff, updateStaff, deactivateStaff };
}
