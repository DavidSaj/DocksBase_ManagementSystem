import { useState, useEffect } from 'react';
import api from '../api.js';

export default function useTools() {
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/tools/').then(r => setTools(r.data.results ?? r.data)).finally(() => setLoading(false));
  }, []);

  async function createTool(payload) {
    const { data } = await api.post('/tools/', payload);
    setTools(prev => [...prev, data]);
    return data;
  }

  async function updateTool(id, payload) {
    const { data } = await api.patch(`/tools/${id}/`, payload);
    setTools(prev => prev.map(t => t.id === id ? data : t));
    return data;
  }

  return { tools, loading, createTool, updateTool };
}
