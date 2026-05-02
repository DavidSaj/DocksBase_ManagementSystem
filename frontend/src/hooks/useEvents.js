import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export function useEvents(filters = {}) {
  const [events,  setEvents]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const fetchEvents = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/events/', { params: filters });
      setEvents(data.results ?? data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(filters)]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  async function createEvent(payload) {
    const { data } = await api.post('/events/', payload);
    setEvents(prev => [...prev, data]);
    return data;
  }

  async function updateEvent(id, patch) {
    const { data } = await api.patch(`/events/${id}/`, patch);
    setEvents(prev => prev.map(e => e.id === id ? data : e));
    return data;
  }

  async function deleteEvent(id) {
    await api.delete(`/events/${id}/`);
    setEvents(prev => prev.filter(e => e.id !== id));
  }

  return { events, loading, error, refetch: fetchEvents, createEvent, updateEvent, deleteEvent };
}

export function useVenueHires() {
  const [venues,  setVenues]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const fetchVenues = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/venue-hires/');
      setVenues(data.results ?? data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchVenues(); }, [fetchVenues]);

  async function createVenue(payload) {
    const { data } = await api.post('/venue-hires/', payload);
    setVenues(prev => [...prev, data]);
    return data;
  }

  async function updateVenue(id, patch) {
    const { data } = await api.patch(`/venue-hires/${id}/`, patch);
    setVenues(prev => prev.map(v => v.id === id ? data : v));
    return data;
  }

  return { venues, loading, error, refetch: fetchVenues, createVenue, updateVenue };
}
