// portal/src/screens/tabs/HomeTab.jsx
import { useState, useEffect } from 'react';
import api from '../../api';
import { useUserContext } from '../../context/UserContext';
import { deriveState } from '../../utils/deriveState';
import ChecklistView from '../../components/portal/ChecklistView';
import CountdownView from '../../components/portal/CountdownView';
import ArrivalView   from '../../components/portal/ArrivalView';
import WalletCard    from '../../components/portal/WalletCard';
import InstallBanner from '../../components/portal/InstallBanner';
import ExtendStayScreen  from '../ExtendStayScreen';
import CraneRequestScreen from '../CraneRequestScreen';
import MemberHomeScreen from './MemberHomeScreen';

// --- Guest checkin flow ---

function GuestCheckinFlow() {
  const bookingId = localStorage.getItem('portal_booking_id');
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [subScreen, setSubScreen] = useState(null);

  function reload() {
    if (!bookingId) {
      setError('No booking session found.');
      setLoading(false);
      return;
    }
    api.get(`/portal/checkin/bookings/${bookingId}/`)
      .then(r => setBooking(r.data))
      .catch(() => setError('Could not load your booking. Please use the link from your email.'))
      .finally(() => setLoading(false));
  }

  useEffect(reload, [bookingId]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ color: 'rgba(0,0,0,0.4)', fontSize: 15, fontFamily: 'IBM Plex Sans, sans-serif' }}>Loading your booking…</div>
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ textAlign: 'center', padding: 32 }}>
          <svg style={{ width: 48, height: 48, marginBottom: 16, stroke: 'rgba(0,0,0,0.2)', fill: 'none', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }} viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 11a1 1 0 01-1-1V7a1 1 0 012 0v5a1 1 0 01-1 1zm0 3a1 1 0 110 2 1 1 0 010-2z"/>
          </svg>
          <div style={{ fontSize: 15, color: 'rgba(0,0,0,0.5)', fontFamily: 'IBM Plex Sans, sans-serif' }}>{error || 'Booking not found.'}</div>
        </div>
      </div>
    );
  }

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
            <button className="p-btn p-btn--outline" style={{ marginBottom: 10 }} onClick={() => setSubScreen('extend-stay')}>
              Extend stay
            </button>
            <button className="p-btn p-btn--outline" onClick={() => setSubScreen('crane-request')}>
              Request crane / lift
            </button>
          </div>
        </>
      )}
      {state === 'arrival'   && <ArrivalView booking={booking} onCheckedIn={reload} />}
      {state === 'countdown' && <CountdownView booking={booking} />}
      {state === 'checklist' && (
        <>
          <ChecklistView booking={booking} onUpdate={reload} />
          <div style={{ padding: '0 16px 32px' }}>
            <button className="p-btn p-btn--outline" onClick={() => setSubScreen('crane-request')}>
              Request crane / lift
            </button>
          </div>
        </>
      )}
      <InstallBanner />
    </>
  );
}

// --- Main HomeTab ---

export default function HomeTab() {
  const { capabilities } = useUserContext();
  if (capabilities?.isGuest) return <GuestCheckinFlow />;
  return <MemberHomeScreen />;
}
