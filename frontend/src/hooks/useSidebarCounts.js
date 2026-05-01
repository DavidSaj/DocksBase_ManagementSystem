import { useState, useEffect } from 'react';
import api from '../api.js';

export default function useSidebarCounts() {
  const [counts, setCounts] = useState({ reservations: 0, maintenance: 0, billing: 0 });

  useEffect(() => {
    Promise.allSettled([
      api.get('/bookings/', { params: { status: 'pending' } }),
      api.get('/booking-requests/', { params: { status: 'pending' } }),
      api.get('/maintenance-tasks/'),
      api.get('/billing/invoices/'),
    ]).then(([bookings, requests, tasks, invoices]) => {
      const arr = r => {
        if (r.status !== 'fulfilled') return [];
        const d = r.value.data;
        return Array.isArray(d) ? d : (Array.isArray(d?.results) ? d.results : []);
      };

      const pendingBookings  = arr(bookings).length;
      const pendingRequests  = arr(requests).length;
      const openTasks        = arr(tasks).filter(t => t.status === 'pending' || t.status === 'in_progress').length;
      const overdueInvoices  = arr(invoices).filter(i => i.status === 'overdue').length;

      setCounts({
        reservations: pendingBookings + pendingRequests,
        maintenance:  openTasks,
        billing:      overdueInvoices,
      });
    });
  }, []);

  return counts;
}
