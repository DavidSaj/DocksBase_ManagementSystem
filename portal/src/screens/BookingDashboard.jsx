import { useState, useEffect } from 'react';
import api from '../api';
import { deriveState } from '../utils/deriveState';
import ChecklistView from '../components/portal/ChecklistView';
import CountdownView from '../components/portal/CountdownView';
import ArrivalView from '../components/portal/ArrivalView';
import WalletCard from '../components/portal/WalletCard';

export default function BookingDashboard() {
  const bookingId = localStorage.getItem('portal_booking_id');
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  function reload() {
    if (!bookingId) { setError('No booking session found.'); setLoading(false); return; }
    api.get(`/portal/checkin/bookings/${bookingId}/`)
      .then(r => setBooking(r.data))
      .catch(() => setError('Could not load your booking. Please use the link from your email.'))
      .finally(() => setLoading(false));
  }

  useEffect(reload, [bookingId]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8' }}>
        <div style={{ color: 'rgba(0,0,0,0.4)', fontSize: 15 }}>Loading your booking…</div>
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8' }}>
        <div style={{ textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚓</div>
          <div style={{ fontSize: 15, color: 'rgba(0,0,0,0.5)' }}>{error || 'Booking not found.'}</div>
        </div>
      </div>
    );
  }

  const state = deriveState(booking);

  if (state === 'wallet') return <WalletCard booking={booking} />;
  if (state === 'arrival') return <ArrivalView booking={booking} onCheckedIn={reload} />;
  if (state === 'countdown') return <CountdownView booking={booking} />;
  return <ChecklistView booking={booking} onUpdate={reload} />;
}
