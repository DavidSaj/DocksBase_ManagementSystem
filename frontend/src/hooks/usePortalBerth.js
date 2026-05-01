import { useState, useEffect } from 'react';
import api from '../api.js';

export default function usePortalBerth() {
  const [berths, setBerths]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    api.get('/portal/berth/')
      .then(r => setBerths(r.data))
      .catch(() => setError('Could not load berth info.'))
      .finally(() => setLoading(false));
  }, []);

  return { berths, loading, error };
}
