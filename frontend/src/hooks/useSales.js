import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export function useListings(filters = {}) {
  const [listings, setListings] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/listings/', { params: filters });
      setListings(data.results ?? data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(filters)]);

  useEffect(() => { fetch(); }, [fetch]);

  async function createListing(payload) {
    const { data } = await api.post('/listings/', payload);
    setListings(prev => [data, ...prev]);
    return data;
  }

  async function updateListing(id, patch) {
    const { data } = await api.patch(`/listings/${id}/`, patch);
    setListings(prev => prev.map(l => l.id === id ? data : l));
    return data;
  }

  async function deleteListing(id) {
    await api.delete(`/listings/${id}/`);
    setListings(prev => prev.filter(l => l.id !== id));
  }

  return { listings, loading, error, refetch: fetch, createListing, updateListing, deleteListing };
}

export function useLeads(filters = {}) {
  const [leads,   setLeads]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/leads/', { params: filters });
      setLeads(data.results ?? data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(filters)]);

  useEffect(() => { fetch(); }, [fetch]);

  async function createLead(payload) {
    const { data } = await api.post('/leads/', payload);
    setLeads(prev => [data, ...prev]);
    return data;
  }

  async function updateLead(id, patch) {
    const { data } = await api.patch(`/leads/${id}/`, patch);
    setLeads(prev => prev.map(l => l.id === id ? data : l));
    return data;
  }

  async function deleteLead(id) {
    await api.delete(`/leads/${id}/`);
    setLeads(prev => prev.filter(l => l.id !== id));
  }

  return { leads, loading, error, refetch: fetch, createLead, updateLead, deleteLead };
}
