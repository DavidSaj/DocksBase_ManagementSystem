import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function usePortalInvoices() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/portal/invoices/')
      .then(r => setInvoices(r.data))
      .catch(() => setError('Could not load invoices.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function markPaid(invoiceId) {
    setInvoices(prev =>
      prev.map(inv => inv.id === invoiceId ? { ...inv, status: 'paid' } : inv)
    );
  }

  return { invoices, loading, error, markPaid, refetch: load };
}
