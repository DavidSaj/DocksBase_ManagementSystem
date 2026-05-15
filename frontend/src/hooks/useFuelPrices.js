import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function useFuelPrices() {
  const [products,  setProducts]  = useState([]);
  const [history,   setHistory]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const [p, h] = await Promise.all([
        api.get('/fuel-dock/products/'),
        api.get('/fuel-dock/price-history/'),
      ]);
      setProducts(p.data.results ?? p.data);
      setHistory(h.data.results  ?? h.data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function updatePrice(id, unit_price, note = '') {
    const { data } = await api.patch(`/fuel-dock/products/${id}/price/`, { unit_price, note });
    setProducts(prev => prev.map(p => (p.id === id ? data : p)));
    const h = await api.get('/fuel-dock/price-history/');
    setHistory(h.data.results ?? h.data);
    return data;
  }

  return { products, history, loading, error, refetch: fetchAll, updatePrice };
}
