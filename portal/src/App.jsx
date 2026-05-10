// portal/src/App.jsx
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTenant } from './context/TenantContext';
import Magic from './screens/Magic';
import LoginScreen      from './screens/LoginScreen';
import AppShell         from './components/shell/AppShell';
import BookingConfirmed from './screens/BookingConfirmed';
import BookingRequest    from './screens/BookingRequest';
import BookingRequestSent from './screens/BookingRequestSent';
import api from './api';

const BOOKING_RESULT = /\/booking\/(\d+)\/(confirmed|cancelled)$/;

async function exchangeMemberToken(rawToken) {
  const { data } = await api.post('/portal/auth/member-magic/verify/', { token: rawToken });
  localStorage.setItem('portal_session_token', data.session_token);
  localStorage.setItem('portal_refresh_token', data.refresh_token);
  localStorage.setItem('portal_token_type',    'member');
  localStorage.setItem('portal_marina_slug',   data.marina_slug);
  window.location.replace(window.location.pathname);
}

export default function App() {
  const [params]    = useSearchParams();
  const { marina, isLoading, tenantSlug, customDomain } = useTenant();
  const [submitted, setSubmitted] = useState(false);

  // --- Guest magic link (booking confirmation) ---
  if (params.get('token')) return <Magic />;

  // --- Member magic link click ---
  const memberToken = params.get('member_token');
  if (memberToken) {
    exchangeMemberToken(memberToken).catch(() => {
      window.location.replace(window.location.pathname);
    });
    return (
      <div className="p-login">
        <div className="p-login__tagline" style={{ color: 'rgba(255,255,255,0.7)' }}>
          Signing you in…
        </div>
      </div>
    );
  }

  // --- Stripe result redirect ---
  const resultMatch = window.location.pathname.match(BOOKING_RESULT);
  if (resultMatch) {
    const cancelled = resultMatch[2] === 'cancelled';
    return <BookingConfirmed marina={marina} bookingId={resultMatch[1]} cancelled={cancelled} />;
  }

  // --- Authenticated shell (guest or member) ---
  const sessionToken = localStorage.getItem('portal_session_token');
  if (sessionToken) {
    return <AppShell initialTab="home" />;
  }

  // --- Unauthenticated ---
  if (isLoading) {
    return (
      <div className="p-login" style={{ justifyContent: 'center' }}>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontFamily: 'IBM Plex Sans, sans-serif' }}>
          Loading…
        </div>
      </div>
    );
  }

  if (!marina) {
    const id = tenantSlug || customDomain || 'this marina';
    return (
      <div className="p-login">
        <div className="p-login__marina-name" style={{ color: 'var(--cream)' }}>
          Marina &quot;{id}&quot; not found.
        </div>
      </div>
    );
  }

  // Booking-only marina
  if (marina.booking_mode === 'manual_approval') {
    if (submitted) return <BookingRequestSent marina={marina} />;
    return <BookingRequest marina={marina} onSubmitted={() => setSubmitted(true)} />;
  }

  return <LoginScreen marina={marina} />;
}
