import { useState, useEffect } from 'react';
import api from '../api.js';

export default function useMarina() {
  const [marina, setMarina] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/marina/profile/').then(r => setMarina(r.data)).finally(() => setLoading(false));
  }, []);

  async function updateMarina(payload) {
    const { data } = await api.patch('/marina/profile/', payload);
    setMarina(data);
    return data;
  }

  return { marina, loading, updateMarina };
}
