import { useEffect, useState } from 'react';
import api from '../api.js';

const POLL_INTERVAL_MS = 30_000;

/**
 * Polls /ais/inbound/ every 30s. Returns:
 *   { rows, loading, error, supported }
 * `supported === false` means the backend returned a 4xx (e.g. AIS isn't
 * configured) so the caller can hide the card entirely.
 */
export default function useInboundETAs() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer;

    const fetchOnce = () => api.get('/ais/inbound/')
      .then(({ data }) => {
        if (cancelled) return;
        setRows(data.inbound || []);
        setError(null);
        setSupported(true);
      })
      .catch(err => {
        if (cancelled) return;
        if (err.response && err.response.status >= 400 && err.response.status < 500) {
          setSupported(false);
        } else {
          setError(err);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    fetchOnce();
    timer = setInterval(fetchOnce, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  return { rows, loading, error, supported };
}
