import { useState, useEffect } from 'react';
import api from '../api.js';

export default function useHaulOuts() {
  const [haulOuts, setHaulOuts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/haul-outs/').then(r => setHaulOuts(r.data.results ?? r.data)).finally(() => setLoading(false));
  }, []);

  async function createHaulOut(payload) {
    const { data } = await api.post('/haul-outs/', payload);
    setHaulOuts(prev => [data, ...prev]);
    return data;
  }

  async function updateHaulOut(id, payload) {
    const { data } = await api.patch(`/haul-outs/${id}/`, payload);
    setHaulOuts(prev => prev.map(h => h.id === id ? data : h));
    return data;
  }

  return { haulOuts, loading, createHaulOut, updateHaulOut };
}
