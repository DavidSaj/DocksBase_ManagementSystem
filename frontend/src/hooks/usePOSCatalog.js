import { useState, useEffect } from 'react';
import api from '../api.js';

export default function usePOSCatalog() {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/billing/service-catalog/');
        if (cancelled) return;
        const ORDER = { diesel: 0, petrol: 1, pump_out: 2 };
        setItems(
          (data.results ?? data)
            .filter(i => i.show_in_pos && i.is_active)
            .sort((a, b) => (ORDER[a.fuel_dock_type] ?? 99) - (ORDER[b.fuel_dock_type] ?? 99))
        );
      } catch (e) {
        if (!cancelled) setError(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { items, loading, error };
}
