import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function useOverview() {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const { data } = await api.get('/marina/overview/');
      setOverview(data);
    } catch {
      // keep previous data on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { overview, loading, refetch };
}
