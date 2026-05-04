import { useState, useEffect } from 'react';
import api from '../api.js';

export default function useReports() {
  const [revenue,     setRevenue]     = useState(null);
  const [occupancy,   setOccupancy]   = useState(null);
  const [utilisation, setUtilisation] = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.get('reports/revenue/'),
      api.get('reports/occupancy/'),
      api.get('reports/utilisation/'),
    ])
      .then(([r, o, u]) => {
        setRevenue(r.data);
        setOccupancy(o.data);
        setUtilisation(u.data);
      })
      .catch((err) => {
        setError(err?.message ?? 'Failed to load reports');
      })
      .finally(() => setLoading(false));
  }, []);

  return { revenue, occupancy, utilisation, loading, error };
}
