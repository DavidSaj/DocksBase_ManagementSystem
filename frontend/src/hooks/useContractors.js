import { useState, useEffect } from 'react';
import api from '../api.js';

export default function useContractors() {
  const [contractors, setContractors] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/contractors/').then(r => setContractors(r.data.results ?? r.data)).finally(() => setLoading(false));
  }, []);

  async function createContractor(payload) {
    const { data } = await api.post('/contractors/', payload);
    setContractors(prev => [...prev, data]);
    return data;
  }

  async function deleteContractor(id) {
    await api.delete(`/contractors/${id}/`);
    setContractors(prev => prev.filter(c => c.id !== id));
  }

  return { contractors, loading, createContractor, deleteContractor };
}
