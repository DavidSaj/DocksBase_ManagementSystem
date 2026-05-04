import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTenant } from './context/TenantContext';
import Magic from './screens/Magic';
import BookingDashboard from './screens/BookingDashboard';
import BookingRequest from './screens/BookingRequest';
import BookingRequestSent from './screens/BookingRequestSent';

export default function App() {
  const [params] = useSearchParams();
  const { marina, isLoading, tenantSlug, customDomain } = useTenant();
  const [submitted, setSubmitted] = useState(false);

  if (params.get('token')) return <Magic />;

  const hasSession = Boolean(localStorage.getItem('portal_session_token'));
  if (hasSession) return <BookingDashboard />;

  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8' }}>
        <div style={{ color: 'rgba(0,0,0,0.4)', fontSize: 15 }}>Loading…</div>
      </div>
    );
  }

  if (!marina) {
    const identifier = tenantSlug || customDomain || 'this marina';
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚓</div>
          <div style={{ fontSize: 16 }}>Marina &quot;{identifier}&quot; not found.</div>
        </div>
      </div>
    );
  }

  if (marina.booking_mode === 'manual_approval') {
    if (submitted) return <BookingRequestSent marina={marina} />;
    return <BookingRequest marina={marina} onSubmitted={() => setSubmitted(true)} />;
  }

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 600, margin: '80px auto', textAlign: 'center' }}>
      <h1>{marina.name}</h1>
      <p>Online booking coming soon.</p>
    </div>
  );
}
