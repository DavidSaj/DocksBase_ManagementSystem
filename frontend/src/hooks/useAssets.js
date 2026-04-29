import { useState, useEffect } from 'react';
import api from '../api.js';

export default function useAssets() {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/assets/').then(r => setAssets(r.data.results ?? r.data)).finally(() => setLoading(false));
  }, []);

  async function createAsset(payload) {
    const { data } = await api.post('/assets/', payload);
    setAssets(prev => [...prev, data]);
    return data;
  }

  async function updateAsset(id, payload) {
    const { data } = await api.patch(`/assets/${id}/`, payload);
    setAssets(prev => prev.map(a => a.id === id ? data : a));
    return data;
  }

  return { assets, loading, createAsset, updateAsset };
}
