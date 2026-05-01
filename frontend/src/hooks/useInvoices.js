import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function useInvoices(filters = {}) {
  const [invoices,  setInvoices]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);

  const fetchInvoices = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/billing/invoices/', { params: filters });
      setInvoices(data.results ?? data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(filters)]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  async function updateInvoice(id, patch) {
    const { data } = await api.patch(`/billing/invoices/${id}/`, patch);
    setInvoices(prev => prev.map(i => i.id === id ? data : i));
    return data;
  }

  return { invoices, loading, error, refetch: fetchInvoices, updateInvoice };
}
