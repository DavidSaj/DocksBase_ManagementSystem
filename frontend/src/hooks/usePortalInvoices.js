import { useState, useEffect } from 'react';
import api from '../api.js';

export default function usePortalInvoices() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    api.get('/portal/invoices/')
      .then(r => setInvoices(r.data))
      .finally(() => setLoading(false));
  }, []);

  return { invoices, loading };
}
