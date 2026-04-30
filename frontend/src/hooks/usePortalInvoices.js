import { useState, useEffect } from 'react';
import api from '../api.js';

export default function usePortalInvoices() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  useEffect(() => {
    api.get('/portal/invoices/')
      .then(r => setInvoices(r.data))
      .catch(() => setError('Could not load invoices.'))
      .finally(() => setLoading(false));
  }, []);

  return { invoices, loading, error };
}
