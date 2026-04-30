import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function useBookings(filters = {}) {
  const [bookings, setBookings] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);

  const fetchBookings = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/bookings/', { params: filters });
      setBookings(data.results ?? data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(filters)]);

  useEffect(() => { fetchBookings(); }, [fetchBookings]);

  async function updateBooking(id, patch) {
    const { data } = await api.patch(`/bookings/${id}/`, patch);
    setBookings(prev => prev.map(b => b.id === id ? data : b));
    return data;
  }

  return { bookings, loading, error, refetch: fetchBookings, updateBooking };
}
