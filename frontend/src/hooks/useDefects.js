import { useState, useEffect } from 'react';
import api from '../api.js';

export default function useDefects() {
  const [defects, setDefects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/defects/').then(r => setDefects(r.data.results ?? r.data)).finally(() => setLoading(false));
  }, []);

  async function createDefect(payload) {
    const { data } = await api.post('/defects/', payload);
    setDefects(prev => [data, ...prev]);
    return data;
  }

  async function updateDefect(id, payload) {
    const { data } = await api.patch(`/defects/${id}/`, payload);
    setDefects(prev => prev.map(d => d.id === id ? data : d));
    return data;
  }

  async function raiseTask(id) {
    const { data } = await api.post(`/defects/${id}/create-task/`);
    setDefects(prev => prev.map(d => d.id === id ? { ...d, status: 'in_progress' } : d));
    return data;
  }

  return { defects, loading, createDefect, updateDefect, raiseTask };
}
