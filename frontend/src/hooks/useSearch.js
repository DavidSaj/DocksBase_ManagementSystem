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

    let aborted = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.get('/search/', { params: { q: query.trim() } });
        if (!aborted) {
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
          setResults([...apiResults, ...navItems]);
        }
      } catch {
        if (!aborted) setResults([]);
      } finally {
        if (!aborted) setLoading(false);
      }
    }, 300);

    return () => {
      aborted = true;
      clearTimeout(timer);
    };
  }, [query]);

  return { results, loading };
}
