import { useState, useEffect } from 'react';
import api from '../api';
import { deriveState } from '../utils/deriveState';
import ChecklistView from '../components/portal/ChecklistView';
import CountdownView from '../components/portal/CountdownView';
import ArrivalView from '../components/portal/ArrivalView';
import WalletCard from '../components/portal/WalletCard';
import InstallBanner from '../components/portal/InstallBanner';
import ExtendStayScreen from './ExtendStayScreen';
import CraneRequestScreen from './CraneRequestScreen';

const BTN_SECONDARY = {
  display: 'block', width: '100%', padding: '14px 0', background: '#fff', color: '#1a2d4a',
  border: '1.5px solid #1a2d4a', borderRadius: 10, fontSize: 15, fontWeight: 600,
  cursor: 'pointer', marginBottom: 10, boxSizing: 'border-box',
};

export default function BookingDashboard() {
  const bookingId = localStorage.getItem('portal_booking_id');
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [subScreen, setSubScreen] = useState(null); // null | 'extend-stay' | 'crane-request'

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

  // Sub-screen navigation
  if (subScreen === 'extend-stay') {
    return <ExtendStayScreen booking={booking} onBack={() => setSubScreen(null)} />;
  }
  if (subScreen === 'crane-request') {
    return <CraneRequestScreen booking={booking} onBack={() => setSubScreen(null)} />;
  }

  const state = deriveState(booking);

  return (
    <>
      {state === 'wallet' && (
        <>
          <WalletCard booking={booking} />
          <div style={{ padding: '0 16px 32px' }}>
            <button style={BTN_SECONDARY} onClick={() => setSubScreen('extend-stay')}>
              Extend stay
            </button>
            <button style={BTN_SECONDARY} onClick={() => setSubScreen('crane-request')}>
              Request crane / lift
            </button>
          </div>
        </>
      )}
      {state === 'arrival' && <ArrivalView booking={booking} onCheckedIn={reload} />}
      {state === 'countdown' && <CountdownView booking={booking} />}
      {state === 'checklist' && (
        <>
          <ChecklistView booking={booking} onUpdate={reload} />
          <div style={{ padding: '0 16px 32px' }}>
            <button style={BTN_SECONDARY} onClick={() => setSubScreen('crane-request')}>
              Request crane / lift
            </button>
          </div>
        </>
      )}
      <InstallBanner />
    </>
  );
}
