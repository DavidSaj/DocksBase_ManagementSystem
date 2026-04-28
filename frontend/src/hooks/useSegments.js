import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function useSegments(filters = {}) {
  const [segments, setSegments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchSegments = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/segments/', { params: filters });
      setSegments(data.results ?? data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(filters)]);

  useEffect(() => { fetchSegments(); }, [fetchSegments]);

  return { segments, loading, error, refetch: fetchSegments };
}
