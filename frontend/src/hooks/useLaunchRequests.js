import { useState, useEffect } from 'react';
import api from '../api.js';

export default function useLaunchRequests() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/launch-requests/').then(r => setRequests(r.data.results ?? r.data)).finally(() => setLoading(false));
  }, []);

  async function createRequest(payload) {
    const { data } = await api.post('/launch-requests/', payload);
    setRequests(prev => [...prev, data]);
    return data;
  }

  async function updateRequest(id, payload) {
    const { data } = await api.patch(`/launch-requests/${id}/`, payload);
    setRequests(prev => prev.map(r => r.id === id ? data : r));
    return data;
  }

  return { requests, loading, createRequest, updateRequest };
}
