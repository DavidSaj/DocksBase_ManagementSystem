import { useEffect, useState } from 'react';
import api from '../api';

export default function Magic() {
  const [error, setError] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
      setError('No token found in URL. Please use the link from your email.');
      return;
    }

    api.post('/portal/checkin/auth/magic/', { token })
      .then(res => {
        localStorage.setItem('portal_session_token', res.data.token);
        localStorage.setItem('portal_token_type', 'guest');
        localStorage.setItem('portal_booking_id', String(res.data.booking_id));
        localStorage.setItem('portal_marina_slug', res.data.marina_slug);
        window.location.replace(window.location.pathname);
      })
      .catch(() => {
        setError('This link has expired or is invalid. Please check your email for a new one.');
      });
  }, []);

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8' }}>
        <div style={{ textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Link expired</div>
          <div style={{ fontSize: 14, color: 'rgba(0,0,0,0.5)' }}>{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8' }}>
      <div style={{ color: 'rgba(0,0,0,0.4)', fontSize: 15 }}>Signing you in…</div>
    </div>
  );
}
