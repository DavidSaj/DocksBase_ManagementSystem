import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

// Transform flat API berths array → HarborMap piers format
export function berthsToPiers(berths) {
  const map = {};
  berths.forEach(b => {
    if (!map[b.pier_code]) map[b.pier_code] = { port: [], starboard: [] };
    const side = b.side === 'starboard' ? 'starboard' : 'port';
    map[b.pier_code][side].push({
      id: b.code,
      status: b.status,
      len: b.length_m ? `${b.length_m}m` : '—',
      vessel: b.vessel_name || null,
      owner: null,
      type: null,
      draft: null,
      _apiId: b.id,
    });
  });
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, sides]) => ({
      id,
      slips: [
        ...sides.port.sort((a, b) => a.id.localeCompare(b.id)),
        ...sides.starboard.sort((a, b) => a.id.localeCompare(b.id)),
      ],
    }));
}

export default function useBerths(filters = {}) {
  const [berths,  setBerths]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const fetchBerths = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/berths/', { params: filters });
      setBerths(data.results ?? data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchBerths(); }, [fetchBerths]);

  const piers  = berthsToPiers(berths);
  const counts = {
    total:       berths.length,
    occupied:    berths.filter(b => b.status === 'occupied').length,
    available:   berths.filter(b => b.status === 'available').length,
    reserved:    berths.filter(b => b.status === 'reserved').length,
    maintenance: berths.filter(b => b.status === 'maintenance').length,
  };

  return { berths, piers, counts, loading, error, refetch: fetchBerths };
}
