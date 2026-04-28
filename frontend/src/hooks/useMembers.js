import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function useMembers(filters = {}) {
  const [members,  setMembers]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);

  const fetchMembers = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/members/', { params: filters });
      setMembers(data.results ?? data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(filters)]);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  async function updateMember(id, patch) {
    const { data } = await api.patch(`/members/${id}/`, patch);
    setMembers(prev => prev.map(m => m.id === id ? data : m));
    return data;
  }

  async function createMember(payload) {
    const { data } = await api.post('/members/', payload);
    setMembers(prev => [...prev, data]);
    return data;
  }

  return { members, loading, error, refetch: fetchMembers, updateMember, createMember };
}
