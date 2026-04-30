import { useState, useEffect } from 'react';
import api from '../api.js';

export default function useIncidents() {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/incidents/').then(r => setIncidents(r.data.results ?? r.data)).finally(() => setLoading(false));
  }, []);

  async function createIncident(payload) {
    const { data } = await api.post('/incidents/', payload);
    setIncidents(prev => [data, ...prev]);
    return data;
  }

  async function updateIncident(id, payload) {
    const { data } = await api.patch(`/incidents/${id}/`, payload);
    setIncidents(prev => prev.map(i => i.id === id ? data : i));
    return data;
  }

  return { incidents, loading, createIncident, updateIncident };
}
