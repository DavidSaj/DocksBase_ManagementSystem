import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function useBookingRequests(filters = {}) {
  const [requests, setRequests] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);

  const fetchRequests = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/booking-requests/', { params: filters });
      setRequests(data.results ?? data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(filters)]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  async function updateRequest(id, patch) {
    const { data } = await api.patch(`/booking-requests/${id}/`, patch);
    setRequests(prev => prev.map(r => r.id === id ? data : r));
    return data;
  }

  async function convertRequest(id) {
    const { data } = await api.post(`/booking-requests/${id}/convert/`);
    await fetchRequests();
    return data;
  }

  async function createRequest(payload) {
    const { data } = await api.post('/booking-requests/', payload);
    setRequests(prev => [...prev, data]);
    return data;
  }

  return { requests, loading, error, refetch: fetchRequests, updateRequest, convertRequest, createRequest };
}
