import { useState, useEffect } from 'react';
import api from '../api.js';

export default function useParts() {
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/parts/').then(r => setParts(r.data.results ?? r.data)).finally(() => setLoading(false));
  }, []);

  async function createPart(payload) {
    const { data } = await api.post('/parts/', payload);
    setParts(prev => [...prev, data]);
    return data;
  }

  async function updatePart(id, payload) {
    const { data } = await api.patch(`/parts/${id}/`, payload);
    setParts(prev => prev.map(p => p.id === id ? data : p));
    return data;
  }

  return { parts, loading, createPart, updatePart };
}
