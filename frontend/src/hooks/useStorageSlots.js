import { useState, useEffect } from 'react';
import api from '../api.js';

export default function useStorageSlots() {
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/storage-slots/').then(r => setSlots(r.data.results ?? r.data)).finally(() => setLoading(false));
  }, []);

  async function createSlot(payload) {
    const { data } = await api.post('/storage-slots/', payload);
    setSlots(prev => [...prev, data]);
    return data;
  }

  async function updateSlot(id, payload) {
    const { data } = await api.patch(`/storage-slots/${id}/`, payload);
    setSlots(prev => prev.map(s => s.id === id ? data : s));
    return data;
  }

  async function deleteSlot(id) {
    await api.delete(`/storage-slots/${id}/`);
    setSlots(prev => prev.filter(s => s.id !== id));
  }

  return { slots, loading, createSlot, updateSlot, deleteSlot };
}
