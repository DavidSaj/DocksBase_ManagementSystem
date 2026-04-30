import { useState, useEffect } from 'react';
import api from '../api.js';

export default function usePortalCraneRequests() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    api.get('/portal/crane-requests/')
      .then(r => setRequests(r.data))
      .finally(() => setLoading(false));
  }, []);

  async function submitRequest(payload) {
    const { data } = await api.post('/portal/crane-requests/', payload);
    setRequests(prev => [data, ...prev]);
    return data;
  }

  return { requests, loading, submitRequest };
}
