import { useState, useEffect } from 'react';
import api from '../api.js';

export default function usePortalVessel() {
  const [vessel, setVessel]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    api.get('/portal/vessel/')
      .then(r => setVessel(r.data))
      .catch(err => {
        if (err.response?.status === 404) {
          setVessel(null);
        } else {
          setError('Could not load vessel info.');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  return { vessel, loading, error };
}
