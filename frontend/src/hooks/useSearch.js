import { useState, useEffect } from 'react';
import api from '../api.js';

const TITLE_MAP = {
  overview:     'Overview',
  map:          'Harbour',
  reservations: 'Reservations',
  vessels:      'Vessel Registry',
  boatyard:     'Boatyard',
  maintenance:  'Maintenance',
  staff:        'Staff & Rota',
  billing:      'Billing',
  reports:      'Reports & Analytics',
  members:      'Members & Owners',
  restaurant:   'Restaurant',
  events:       'Events & Venue Hire',
  settings:     'Settings',
  documents:    'Documents & eSign',
  sales:        'Boat Sales & Brokerage',
};

export default function useSearch(query) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query || query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.get('/search/', {
          params: { q: query.trim() },
          signal: controller.signal,
        });
        if (cancelled) return;
        const apiResults = r.data;
        const q = query.trim().toLowerCase();
        const navItems = Object.entries(TITLE_MAP)
          .filter(([, title]) => title.toLowerCase().includes(q))
          .map(([key, title]) => ({
            type: 'nav',
            id: key,
            label: title,
            sub: 'Navigation',
            screen: key,
            link_id: null,
          }));
        // Result groups are produced downstream by SearchDropdown (per
        // target_model). We append nav items at the end so the dropdown
        // renders Boaters / Vessels / Bookings / … then Navigation.
        setResults([...apiResults, ...navItems]);
      } catch (err) {
        if (cancelled) return;
        // Axios marks aborted requests with err.name === 'CanceledError'
        // or err.code === 'ERR_CANCELED'.
        if (
          err?.name === 'CanceledError' ||
          err?.code === 'ERR_CANCELED' ||
          controller.signal.aborted
        ) {
          return;
        }
        console.error('[useSearch] search failed', err);
        setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return { results, loading };
}
