import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function useFuelEntries({ limit = 20 } = {}) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const fetchEntries = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/fuel-dock/queue/', {
        params: { status: 'completed', active: '0', ordering: '-completed_at', limit },
      });
      setEntries(data.results ?? data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  return { entries, loading, error, refetch: fetchEntries };
}
