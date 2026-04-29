import { useState, useEffect } from 'react';
import api from '../api.js';

export default function useEnvelopes() {
  const [envelopes, setEnvelopes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/envelopes/').then(r => {
      setEnvelopes(r.data.results ?? r.data);
    }).finally(() => setLoading(false));
  }, []);

  async function sendEnvelope(payload) {
    const { data } = await api.post('/envelopes/', payload);
    setEnvelopes(prev => [data, ...prev]);
    return data;
  }

  async function getDownloadUrl(id) {
    const { data } = await api.get(`/envelopes/${id}/download/`);
    return data.url;
  }

  return { envelopes, loading, sendEnvelope, getDownloadUrl };
}
