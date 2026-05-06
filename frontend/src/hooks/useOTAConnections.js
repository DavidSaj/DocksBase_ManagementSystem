import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function useOTAConnections() {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    api.get('/ota-connections/')
      .then(r => setConnections(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return { connections, setConnections, loading, reload };
}
