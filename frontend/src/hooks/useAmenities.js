import { useState, useEffect, useCallback } from 'react';
import api from '../api';

export function useAmenities() {
  const [amenities, setAmenities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/berths/amenities/')
      .then(r => { setAmenities(r.data); setLoading(false); })
      .catch(e => { setError(e); setLoading(false); });
  }, []);

  const createAmenity = useCallback(async (data) => {
    const r = await api.post('/berths/amenities/', data);
    setAmenities(prev => [...prev, r.data]);
    return r.data;
  }, []);

  const updateAmenity = useCallback(async (id, data) => {
    const r = await api.patch(`/berths/amenities/${id}/`, data);
    setAmenities(prev => prev.map(a => a.id === id ? r.data : a));
    return r.data;
  }, []);

  const deleteAmenity = useCallback(async (id) => {
    await api.delete(`/berths/amenities/${id}/`);
    setAmenities(prev => prev.filter(a => a.id !== id));
  }, []);

  return { amenities, loading, error, createAmenity, updateAmenity, deleteAmenity };
}
